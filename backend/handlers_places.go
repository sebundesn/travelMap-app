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
	CountryCode *string `json:"countryCode"`
	Region      *string `json:"region"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	VisitedDate *string `json:"visitedDate"`
	Notes       *string `json:"notes"`
	Media       []Media `json:"media"`
}

const maxMediaPerPlace = 30

const placeColumns = `id, name, country, country_code, region, lat, lng, visited_date, notes, created_at`

func scanPlace(row interface{ Scan(...any) error }, p *Place) error {
	if err := row.Scan(&p.ID, &p.Name, &p.Country, &p.CountryCode, &p.Region, &p.Lat, &p.Lng, &p.VisitedDate, &p.Notes, &p.CreatedAt); err != nil {
		return err
	}
	if p.CountryCode != nil && p.Region != nil {
		p.Prefecture = prefectureFor(*p.CountryCode, *p.Region)
	}
	return nil
}

func (s *server) handleListPlaces(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	rows, err := s.db.Query(
		`SELECT `+placeColumns+` FROM places WHERE user_id = $1 ORDER BY created_at DESC`, userID,
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
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read places")
		return
	}
	if err := s.attachMedia(userID, places); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load media")
		return
	}
	writeJSON(w, http.StatusOK, places)
}

// attachMedia fills in the album of every place in one query.
func (s *server) attachMedia(userID int64, places []Place) error {
	for i := range places {
		places[i].Media = []Media{}
	}
	if len(places) == 0 {
		return nil
	}
	rows, err := s.db.Query(
		`SELECT m.place_id, m.url, m.kind FROM place_media m
		 JOIN places p ON p.id = m.place_id
		 WHERE p.user_id = $1 ORDER BY m.position, m.id`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	index := make(map[int64]int, len(places))
	for i, p := range places {
		index[p.ID] = i
	}
	for rows.Next() {
		var placeID int64
		var m Media
		if err := rows.Scan(&placeID, &m.URL, &m.Kind); err != nil {
			return err
		}
		if i, ok := index[placeID]; ok {
			places[i].Media = append(places[i].Media, m)
		}
	}
	return rows.Err()
}

// cleanMedia keeps only files this server stored, in order, capped per place.
func cleanMedia(raw []Media) []Media {
	clean := make([]Media, 0, len(raw))
	for _, m := range raw {
		if !strings.HasPrefix(m.URL, "/uploads/") || strings.Contains(m.URL, "..") {
			continue
		}
		if m.Kind != mediaImage && m.Kind != mediaVideo {
			continue
		}
		clean = append(clean, m)
		if len(clean) == maxMediaPerPlace {
			break
		}
	}
	return clean
}

// replaceMedia rewrites a place's album inside the caller's transaction.
func replaceMedia(tx *sql.Tx, placeID int64, media []Media) error {
	if _, err := tx.Exec(`DELETE FROM place_media WHERE place_id = $1`, placeID); err != nil {
		return err
	}
	for i, m := range media {
		if _, err := tx.Exec(
			`INSERT INTO place_media (place_id, url, kind, position) VALUES ($1, $2, $3, $4)`,
			placeID, m.URL, m.Kind, i); err != nil {
			return err
		}
	}
	return nil
}

// loadPlace reads one place with its album.
func (s *server) loadPlace(id, userID int64) (Place, error) {
	var p Place
	if err := scanPlace(s.db.QueryRow(
		`SELECT `+placeColumns+` FROM places WHERE id = $1 AND user_id = $2`, id, userID), &p); err != nil {
		return p, err
	}
	one := []Place{p}
	if err := s.attachMedia(userID, one); err != nil {
		return p, err
	}
	return one[0], nil
}

// cleanCountryCode keeps only a well-formed ISO 3166-1 alpha-2 code, upper-cased.
func cleanCountryCode(raw *string) *string {
	if raw == nil {
		return nil
	}
	code := strings.ToUpper(strings.TrimSpace(*raw))
	if len(code) != 2 || code[0] < 'A' || code[0] > 'Z' || code[1] < 'A' || code[1] > 'Z' {
		return nil
	}
	return &code
}

func cleanRegion(raw *string) *string {
	if raw == nil {
		return nil
	}
	region := strings.TrimSpace(*raw)
	if region == "" {
		return nil
	}
	return &region
}

func decodePlaceRequest(w http.ResponseWriter, r *http.Request) (placeRequest, bool) {
	var req placeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return req, false
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Country = strings.TrimSpace(req.Country)
	req.CountryCode = cleanCountryCode(req.CountryCode)
	req.Region = cleanRegion(req.Region)
	req.Media = cleanMedia(req.Media)
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

	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save place")
		return
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO places (user_id, name, country, country_code, region, lat, lng, visited_date, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		userID, req.Name, req.Country, req.CountryCode, req.Region, req.Lat, req.Lng, req.VisitedDate, req.Notes,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save place")
		return
	}
	if err := replaceMedia(tx, id, req.Media); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save media")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save place")
		return
	}

	p, err := s.loadPlace(id, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "saved but failed to load place")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *server) handleUpdatePlace(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id, err := atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid place id")
		return
	}
	req, ok := decodePlaceRequest(w, r)
	if !ok {
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update place")
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`UPDATE places SET name = $1, country = $2, country_code = COALESCE($3, country_code),
		        region = COALESCE($4, region), visited_date = $5, notes = $6
		 WHERE id = $7 AND user_id = $8`,
		req.Name, req.Country, req.CountryCode, req.Region, req.VisitedDate, req.Notes, id, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update place")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	if err := replaceMedia(tx, id, req.Media); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save media")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update place")
		return
	}

	p, err := s.loadPlace(id, userID)
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
	id, err := atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid place id")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete place")
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(`DELETE FROM places WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete place")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	if _, err := tx.Exec(`DELETE FROM place_media WHERE place_id = $1`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete place")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete place")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
