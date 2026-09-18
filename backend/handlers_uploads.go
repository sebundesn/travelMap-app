package main

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const maxUploadSize = 8 << 20 // 8MB

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

// handleUpload stores a single image and returns the path it is served from.
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "image is too large (max 8MB)")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no image in request")
		return
	}
	defer file.Close()

	head := make([]byte, 512)
	n, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		writeError(w, http.StatusBadRequest, "failed to read image")
		return
	}
	ext, ok := allowedImageTypes[http.DetectContentType(head[:n])]
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported image format")
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read image")
		return
	}

	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store image")
		return
	}
	name, err := randomName()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store image")
		return
	}
	name += ext

	dst, err := os.Create(filepath.Join(s.uploadDir, name))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store image")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store image")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"url": "/uploads/" + name})
}
