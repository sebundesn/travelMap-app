package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// pgUniqueViolation is Postgres's SQLSTATE for a unique constraint conflict.
const pgUniqueViolation = "23505"

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

	handle, err := generateHandle(s.db, req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	var userID int64
	err = s.db.QueryRow(
		`INSERT INTO users (email, password_hash, name, handle) VALUES ($1, $2, $3, $4) RETURNING id`,
		req.Email, hash, req.Name, handle,
	).Scan(&userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	if err := s.issueSession(w, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start session")
		return
	}
	u, err := s.loadUser(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "created but failed to load profile")
		return
	}
	writeJSON(w, http.StatusCreated, u)
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
		`SELECT id, email, name, handle, avatar_url, bio, password_hash FROM users WHERE email = $1`, req.Email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Handle, &u.AvatarURL, &u.Bio, &u.PasswordHash)
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
	writeJSON(w, http.StatusOK, u)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}
