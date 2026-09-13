package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if req.Email == "" || req.Password == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "email, password, and name are required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to process password")
		return
	}

	res, err := s.db.Exec(
		`INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)`,
		req.Email, hash, req.Name,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}
	userID, _ := res.LastInsertId()

	if err := s.issueSession(w, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start session")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id": userID, "email": req.Email, "name": req.Name,
	})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	var u User
	err := s.db.QueryRow(
		`SELECT id, email, name, password_hash FROM users WHERE email = ?`, req.Email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash)
	if err == sql.ErrNoRows || (err == nil && !checkPassword(u.PasswordHash, req.Password)) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err != nil && err != sql.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "failed to log in")
		return
	}

	if err := s.issueSession(w, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id": u.ID, "email": u.Email, "name": u.Name,
	})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	id := currentUserID(r)
	var u User
	err := s.db.QueryRow(`SELECT id, email, name FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Email, &u.Name)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id": u.ID, "email": u.Email, "name": u.Name,
	})
}
