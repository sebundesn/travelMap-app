package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}

func atoi(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
