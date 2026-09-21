package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	maxImageSize = 8 << 20   // 8MB
	maxVideoSize = 100 << 20 // 100MB
	// maxVideoDuration is what "a short clip" means for an album.
	maxVideoDuration = 15 * time.Second
	// A container's rounding can push a 15s clip a hair over.
	videoDurationSlack = 300 * time.Millisecond

	mediaImage = "image"
	mediaVideo = "video"
)

var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

func randomName() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// sniffVideoExt recognises the ISO base media files phones record: MP4 and QuickTime MOV.
func sniffVideoExt(head []byte) (string, bool) {
	if len(head) < 12 || string(head[4:8]) != "ftyp" {
		return "", false
	}
	if string(head[8:12]) == "qt  " {
		return ".mov", true
	}
	return ".mp4", true
}

var errNoDuration = errors.New("video duration not found")

// videoDuration reads the movie header of an MP4/MOV without decoding it.
func videoDuration(f io.ReaderAt, size int64) (time.Duration, error) {
	moovStart, moovEnd, err := findBox(f, 0, size, "moov")
	if err != nil {
		return 0, err
	}
	start, end, err := findBox(f, moovStart, moovEnd, "mvhd")
	if err != nil {
		return 0, err
	}
	// version(1) flags(3), then 32-bit times in v0 or 64-bit times in v1.
	buf := make([]byte, 32)
	n, _ := f.ReadAt(buf, start)
	buf = buf[:n]
	if end-start < 20 || len(buf) < 20 {
		return 0, errNoDuration
	}
	var timescale uint32
	var duration uint64
	if buf[0] == 1 {
		if len(buf) < 32 {
			return 0, errNoDuration
		}
		timescale = binary.BigEndian.Uint32(buf[20:24])
		duration = binary.BigEndian.Uint64(buf[24:32])
	} else {
		timescale = binary.BigEndian.Uint32(buf[12:16])
		duration = uint64(binary.BigEndian.Uint32(buf[16:20]))
	}
	if timescale == 0 {
		return 0, errNoDuration
	}
	return time.Duration(float64(duration) / float64(timescale) * float64(time.Second)), nil
}

// findBox walks the boxes between [from, to) and returns the payload range of the first one named typ.
func findBox(f io.ReaderAt, from, to int64, typ string) (int64, int64, error) {
	for pos := from; pos+8 <= to; {
		var hdr [16]byte
		n, _ := f.ReadAt(hdr[:], pos)
		if n < 8 {
			break
		}
		size := int64(binary.BigEndian.Uint32(hdr[0:4]))
		headerLen := int64(8)
		switch size {
		case 0:
			size = to - pos
		case 1:
			if n < 16 {
				return 0, 0, errNoDuration
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
			headerLen = 16
		}
		if size < headerLen || pos+size > to {
			break
		}
		if string(hdr[4:8]) == typ {
			return pos + headerLen, pos + size, nil
		}
		pos += size
	}
	return 0, 0, errNoDuration
}

// handleUpload stores one photo or short video and returns the path it is served from.
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxVideoSize+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "ファイルが大きすぎます")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no file in request")
		return
	}
	defer file.Close()

	head := make([]byte, 512)
	n, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}
	head = head[:n]

	kind, ext := mediaImage, ""
	if e, ok := allowedImageTypes[http.DetectContentType(head)]; ok {
		ext = e
		if header.Size > maxImageSize {
			writeError(w, http.StatusBadRequest, "画像は8MBまでです")
			return
		}
	} else if e, ok := sniffVideoExt(head); ok {
		kind, ext = mediaVideo, e
		if header.Size > maxVideoSize {
			writeError(w, http.StatusBadRequest, "動画は100MBまでです")
			return
		}
		d, err := videoDuration(file, header.Size)
		if err != nil {
			writeError(w, http.StatusBadRequest, "動画の長さを確認できませんでした")
			return
		}
		if d > maxVideoDuration+videoDurationSlack {
			writeError(w, http.StatusBadRequest, "動画は15秒以内にしてください")
			return
		}
	} else {
		writeError(w, http.StatusBadRequest, "対応していないファイル形式です")
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}

	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}
	name, err := randomName()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}
	name += ext

	dst, err := os.Create(filepath.Join(s.uploadDir, name))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	writeJSON(w, http.StatusCreated, Media{URL: "/uploads/" + name, Kind: kind})
}
