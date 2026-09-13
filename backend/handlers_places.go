package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

type placeRequest struct {
	Name        string  `json:"name"`
	Country     string  `json:"country"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	VisitedDate *string `json:"visitedDate"`
	Notes       *string `json:"notes"`
}

func (s *server) handleListPlaces(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	rows, err := s.db.Query(
		`SELECT id, name, country, lat, lng, visited_date, notes, created_at
		 FROM places WHERE user_id = ? ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load places")
		return
	}
	defer rows.Close()

	places := []Place{}
	for rows.Next() {
		var p Place
		if err := rows.Scan(&p.ID, &p.Name, &p.Country, &p.Lat, &p.Lng, &p.VisitedDate, &p.Notes, &p.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read places")
			return
		}
		places = append(places, p)
	}
	writeJSON(w, http.StatusOK, places)
}

func (s *server) handleCreatePlace(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	var req placeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Country = strings.TrimSpace(req.Country)
	if req.Name == "" || req.Country == "" {
		writeError(w, http.StatusBadRequest, "name and country are required")
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		writeError(w, http.StatusBadRequest, "invalid coordinates")
		return
	}

	res, err := s.db.Exec(
		`INSERT INTO places (user_id, name, country, lat, lng, visited_date, notes)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, req.Name, req.Country, req.Lat, req.Lng, req.VisitedDate, req.Notes,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save place")
		return
	}
	id, _ := res.LastInsertId()

	var p Place
	err = s.db.QueryRow(
		`SELECT id, name, country, lat, lng, visited_date, notes, created_at FROM places WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.Country, &p.Lat, &p.Lng, &p.VisitedDate, &p.Notes, &p.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "saved but failed to load place")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *server) handleDeletePlace(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id := r.PathValue("id")

	res, err := s.db.Exec(`DELETE FROM places WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete place")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
