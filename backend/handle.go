package main

import (
	"crypto/rand"
	"database/sql"
	"math/big"
	"regexp"
	"strings"
)

// Handles are the public ID people type or scan to add each other.
var (
	handleFormat = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
	handleStrip  = regexp.MustCompile(`[^a-z0-9_]+`)
)

// suffixAlphabet drops look-alike characters so a handle survives being read aloud.
const suffixAlphabet = "abcdefghijkmnpqrstuvwxyz23456789"

func normalizeHandle(raw string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "@")))
}

func validHandle(h string) bool {
	return handleFormat.MatchString(h)
}

func randomSuffix(n int) (string, error) {
	b := make([]byte, n)
	max := big.NewInt(int64(len(suffixAlphabet)))
	for i := range b {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = suffixAlphabet[idx.Int64()]
	}
	return string(b), nil
}

func handleTaken(db *sql.DB, handle string, exceptUserID int64) (bool, error) {
	var id int64
	err := db.QueryRow(`SELECT id FROM users WHERE handle = ?`, handle).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return id != exceptUserID, nil
}

// generateHandle derives a free handle from a display name, e.g. "Sebun" -> "sebun" or "sebun_k3f2".
func generateHandle(db *sql.DB, name string) (string, error) {
	base := handleStrip.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "")
	if len(base) > 12 {
		base = base[:12]
	}
	if len(base) < 3 {
		base = "traveler"
	}

	for attempt := 0; attempt < 12; attempt++ {
		candidate := base
		if attempt > 0 {
			suffix, err := randomSuffix(4)
			if err != nil {
				return "", err
			}
			candidate = base + "_" + suffix
		}
		taken, err := handleTaken(db, candidate, 0)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return randomSuffix(10)
}
