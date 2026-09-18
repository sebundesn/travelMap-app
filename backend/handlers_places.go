package main

import (
	"database/sql"
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
	ImageURL    *string `json:"imageUrl"`
}

const placeColumns = `id, name, country, lat, lng, visited_date, notes, image_url, created_at`

func scanPlace(row interface{ Scan(...any) error }, p *Place) error {
	return row.Scan(&p.ID, &p.Name, &p.Country, &p.Lat, &p.Lng, &p.VisitedDate, &p.Notes, &p.ImageURL, &p.CreatedAt)
}

func (s *server) handleListPlaces(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	rows, err := s.db.Query(
		`SELECT `+placeColumns+` FROM places WHERE user_id = ? ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load places")
		return
	}
	defer rows.Close()

	places := []Place{}
	for rows.Next() {
		var p Place
		if err := scanPlace(rows, &p); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read places")
			return
		}
		places = append(places, p)
	}
	writeJSON(w, http.StatusOK, places)
}

func decodePlaceRequest(w http.ResponseWriter, r *http.Request) (placeRequest, bool) {
	var req placeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return req, false
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Country = strings.TrimSpace(req.Country)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return req, false
	}
	return req, true
}

func (s *server) handleCreatePlace(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	req, ok := decodePlaceRequest(w, r)
	if !ok {
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		writeError(w, http.StatusBadRequest, "invalid coordinates")
		return
	}

	res, err := s.db.Exec(
		`INSERT INTO places (user_id, name, country, lat, lng, visited_date, notes, image_url)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, req.Name, req.Country, req.Lat, req.Lng, req.VisitedDate, req.Notes, req.ImageURL,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save place")
		return
	}
	id, _ := res.LastInsertId()

	var p Place
	if err := scanPlace(s.db.QueryRow(`SELECT `+placeColumns+` FROM places WHERE id = ?`, id), &p); err != nil {
		writeError(w, http.StatusInternalServerError, "saved but failed to load place")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *server) handleUpdatePlace(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id := r.PathValue("id")
	req, ok := decodePlaceRequest(w, r)
	if !ok {
		return
	}

	res, err := s.db.Exec(
		`UPDATE places SET name = ?, country = ?, visited_date = ?, notes = ?, image_url = ?
		 WHERE id = ? AND user_id = ?`,
		req.Name, req.Country, req.VisitedDate, req.Notes, req.ImageURL, id, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update place")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}

	var p Place
	err = scanPlace(s.db.QueryRow(`SELECT `+placeColumns+` FROM places WHERE id = ? AND user_id = ?`, id, userID), &p)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "updated but failed to load place")
		return
	}
	writeJSON(w, http.StatusOK, p)
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
