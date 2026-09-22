package main

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Stats is everything the record and ranking screens derive from one member's pins.
type Stats struct {
	Spots       int      `json:"spots"`
	Countries   []string `json:"countries"`
	Prefectures []int    `json:"prefectures"`
	DistanceKm  float64  `json:"distanceKm"`
	// DatedSpots are the pins whose visit date could be used to order the trip.
	DatedSpots int `json:"datedSpots"`
	// Unresolved pins have no country yet; the client fills them in on the map screen.
	Unresolved int `json:"unresolved"`
}

type statPlace struct {
	CountryCode string
	Region      string
	Lat, Lng    float64
	VisitedDate string
	CreatedAt   time.Time
}

const earthRadiusKm = 6371.0088

// haversineKm is the great-circle distance between two coordinates.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(a)))
}

func computeStats(places []statPlace) Stats {
	st := Stats{Spots: len(places), Countries: []string{}, Prefectures: []int{}}
	countries := map[string]bool{}
	prefs := map[int]bool{}

	type dated struct {
		date time.Time
		p    statPlace
	}
	var trip []dated

	for _, p := range places {
		if p.CountryCode == "" {
			st.Unresolved++
		} else {
			countries[p.CountryCode] = true
		}
		if code := prefectureFor(p.CountryCode, p.Region); code > 0 {
			prefs[code] = true
		}
		if t, err := time.Parse("2006-01-02", p.VisitedDate); err == nil {
			trip = append(trip, dated{t, p})
		}
	}

	for c := range countries {
		st.Countries = append(st.Countries, c)
	}
	sort.Strings(st.Countries)
	for code := range prefs {
		st.Prefectures = append(st.Prefectures, code)
	}
	sort.Ints(st.Prefectures)

	// Travel order comes from the album dates; pins without a date can't be placed in it.
	sort.SliceStable(trip, func(i, j int) bool {
		if !trip[i].date.Equal(trip[j].date) {
			return trip[i].date.Before(trip[j].date)
		}
		return trip[i].p.CreatedAt.Before(trip[j].p.CreatedAt)
	})
	st.DatedSpots = len(trip)
	for i := 1; i < len(trip); i++ {
		a, b := trip[i-1].p, trip[i].p
		st.DistanceKm += haversineKm(a.Lat, a.Lng, b.Lat, b.Lng)
	}
	st.DistanceKm = math.Round(st.DistanceKm*10) / 10
	return st
}

// loadStatPlaces groups pins by owner for the given members.
func (s *server) loadStatPlaces(userIDs []int64) (map[int64][]statPlace, error) {
	out := map[int64][]statPlace{}
	if len(userIDs) == 0 {
		return out, nil
	}
	args := make([]any, len(userIDs))
	placeholders := make([]string, len(userIDs))
	for i, id := range userIDs {
		args[i] = id
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	rows, err := s.db.Query(
		`SELECT user_id, COALESCE(country_code, ''), COALESCE(region, ''), lat, lng,
		        COALESCE(visited_date, ''), created_at
		 FROM places WHERE user_id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		var p statPlace
		if err := rows.Scan(&uid, &p.CountryCode, &p.Region, &p.Lat, &p.Lng, &p.VisitedDate, &p.CreatedAt); err != nil {
			return nil, err
		}
		out[uid] = append(out[uid], p)
	}
	return out, rows.Err()
}

func (s *server) handleMyStats(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	byUser, err := s.loadStatPlaces([]int64{userID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load stats")
		return
	}
	writeJSON(w, http.StatusOK, computeStats(byUser[userID]))
}
