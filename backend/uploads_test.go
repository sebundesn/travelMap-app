package main

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"
)

func box(typ string, payload ...[]byte) []byte {
	body := bytes.Join(payload, nil)
	out := make([]byte, 8, 8+len(body))
	binary.BigEndian.PutUint32(out, uint32(8+len(body)))
	copy(out[4:], typ)
	return append(out, body...)
}

func mvhdV0(timescale, duration uint32) []byte {
	p := make([]byte, 100)
	binary.BigEndian.PutUint32(p[12:], timescale)
	binary.BigEndian.PutUint32(p[16:], duration)
	return box("mvhd", p)
}

func mvhdV1(timescale uint32, duration uint64) []byte {
	p := make([]byte, 112)
	p[0] = 1
	binary.BigEndian.PutUint32(p[20:], timescale)
	binary.BigEndian.PutUint64(p[24:], duration)
	return box("mvhd", p)
}

func TestVideoDuration(t *testing.T) {
	ftyp := box("ftyp", []byte("isom\x00\x00\x02\x00isomiso2"))
	mdat := box("mdat", make([]byte, 64))

	cases := []struct {
		name string
		file []byte
		want time.Duration
	}{
		{"moov first", bytes.Join([][]byte{ftyp, box("moov", mvhdV0(1000, 12500)), mdat}, nil), 12500 * time.Millisecond},
		{"moov last", bytes.Join([][]byte{ftyp, mdat, box("moov", mvhdV0(600, 9000))}, nil), 15 * time.Second},
		{"version 1", bytes.Join([][]byte{ftyp, box("moov", mvhdV1(90000, 90000*30)), mdat}, nil), 30 * time.Second},
	}
	for _, c := range cases {
		got, err := videoDuration(bytes.NewReader(c.file), int64(len(c.file)))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}

	noMoov := bytes.Join([][]byte{ftyp, mdat}, nil)
	if _, err := videoDuration(bytes.NewReader(noMoov), int64(len(noMoov))); err == nil {
		t.Error("expected an error when there is no moov box")
	}
}

func TestSniffVideoExt(t *testing.T) {
	if ext, ok := sniffVideoExt(box("ftyp", []byte("qt  \x00\x00\x00\x00"))); !ok || ext != ".mov" {
		t.Errorf("mov: got %q %v", ext, ok)
	}
	if ext, ok := sniffVideoExt(box("ftyp", []byte("isom\x00\x00\x00\x00"))); !ok || ext != ".mp4" {
		t.Errorf("mp4: got %q %v", ext, ok)
	}
	if _, ok := sniffVideoExt([]byte("GIF89a......")); ok {
		t.Error("gif must not sniff as video")
	}
}
