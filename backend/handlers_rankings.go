package main

import (
	"net/http"
	"sort"
)

const worldRankingLimit = 50

// RankEntry is one row of a leaderboard.
type RankEntry struct {
	Rank        int        `json:"rank"`
	User        PublicUser `json:"user"`
	Spots       int        `json:"spots"`
	Countries   int        `json:"countries"`
	Prefectures int        `json:"prefectures"`
	DistanceKm  float64    `json:"distanceKm"`
	IsMe        bool       `json:"isMe"`
}

func (e RankEntry) metric(name string) float64 {
	switch name {
	case "prefectures":
		return float64(e.Prefectures)
	case "distance":
		return e.DistanceKm
	case "spots":
		return float64(e.Spots)
	default:
		return float64(e.Countries)
	}
}

var rankMetrics = map[string]bool{"countries": true, "prefectures": true, "distance": true, "spots": true}

// handleRankings ranks the signed-in member against friends or everyone who has opted in.
func (s *server) handleRankings(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	scope := r.URL.Query().Get("scope")
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "countries"
	}
	if (scope != "friends" && scope != "world") || !rankMetrics[metric] {
		writeError(w, http.StatusBadRequest, "invalid scope or metric")
		return
	}

	var query string
	var args []any
	if scope == "friends" {
		query = `SELECT ` + publicUserColumns + `, 1 FROM users u
			WHERE u.id = ? OR u.id IN (
				SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
				FROM friendships f
				WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?))`
		args = []any{userID, userID, userID, userID}
	} else {
		query = `SELECT ` + publicUserColumns + `, u.rank_public FROM users u
			WHERE u.rank_public = 1 OR u.id = ?`
		args = []any{userID}
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load rankings")
		return
	}
	defer rows.Close()

	type candidate struct {
		entry  RankEntry
		listed bool
	}
	var cands []candidate
	var ids []int64
	for rows.Next() {
		var c candidate
		var listed int
		if err := rows.Scan(&c.entry.User.ID, &c.entry.User.Name, &c.entry.User.Handle,
			&c.entry.User.AvatarURL, &c.entry.User.Bio, &listed); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read rankings")
			return
		}
		c.listed = listed == 1
		c.entry.IsMe = c.entry.User.ID == userID
		cands = append(cands, c)
		ids = append(ids, c.entry.User.ID)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read rankings")
		return
	}

	byUser, err := s.loadStatPlaces(ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load rankings")
		return
	}

	var listed []RankEntry
	var me *RankEntry
	for _, c := range cands {
		st := computeStats(byUser[c.entry.User.ID])
		c.entry.Spots = st.Spots
		c.entry.Countries = len(st.Countries)
		c.entry.Prefectures = len(st.Prefectures)
		c.entry.DistanceKm = st.DistanceKm
		if c.listed {
			listed = append(listed, c.entry)
		}
		if c.entry.IsMe {
			e := c.entry
			me = &e
		}
	}

	sort.SliceStable(listed, func(i, j int) bool {
		a, b := listed[i].metric(metric), listed[j].metric(metric)
		if a != b {
			return a > b
		}
		return listed[i].User.Name < listed[j].User.Name
	})
	// Ties share a rank (1, 2, 2, 4), so equal scores never look like a win.
	for i := range listed {
		if i > 0 && listed[i].metric(metric) == listed[i-1].metric(metric) {
			listed[i].Rank = listed[i-1].Rank
		} else {
			listed[i].Rank = i + 1
		}
		if listed[i].IsMe && me != nil {
			me.Rank = listed[i].Rank
		}
	}

	total := len(listed)
	if scope == "world" && len(listed) > worldRankingLimit {
		listed = listed[:worldRankingLimit]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"scope":   scope,
		"metric":  metric,
		"total":   total,
		"entries": listed,
		// me.rank is 0 when the member has opted out of the world ranking.
		"me": me,
	})
}
