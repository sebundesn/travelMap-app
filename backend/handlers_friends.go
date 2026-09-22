package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Relation states the client renders differently on a profile card.
const (
	relationSelf     = "self"
	relationNone     = "none"
	relationFriends  = "friends"
	relationIncoming = "incoming"
	relationOutgoing = "outgoing"
)

// relationTo reports where `me` stands with `other`, plus the row id when a request is pending.
func (s *server) relationTo(me, other int64) (string, *int64, error) {
	if me == other {
		return relationSelf, nil, nil
	}
	var id int64
	var requester int64
	var status string
	err := s.db.QueryRow(
		`SELECT id, requester_id, status FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $3 AND addressee_id = $4)`,
		me, other, other, me,
	).Scan(&id, &requester, &status)
	if err == sql.ErrNoRows {
		return relationNone, nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	if status == "accepted" {
		return relationFriends, nil, nil
	}
	if requester == me {
		return relationOutgoing, &id, nil
	}
	return relationIncoming, &id, nil
}

// handleListFriends returns confirmed friends only.
func (s *server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	rows, err := s.db.Query(
		`SELECT `+publicUserColumns+`, (SELECT COUNT(*) FROM places p WHERE p.user_id = u.id)
		 FROM friendships f
		 JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
		 WHERE f.status = 'accepted' AND (f.requester_id = $2 OR f.addressee_id = $3)
		 ORDER BY LOWER(u.name)`,
		userID, userID, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load friends")
		return
	}
	defer rows.Close()

	friends := []Friend{}
	for rows.Next() {
		var f Friend
		if err := rows.Scan(&f.ID, &f.Name, &f.Handle, &f.AvatarURL, &f.Bio, &f.SpotCount); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read friends")
			return
		}
		friends = append(friends, f)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read friends")
		return
	}
	writeJSON(w, http.StatusOK, friends)
}

func (s *server) queryRequests(query string, userID int64) ([]FriendRequest, error) {
	rows, err := s.db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []FriendRequest{}
	for rows.Next() {
		var req FriendRequest
		if err := rows.Scan(&req.ID, &req.CreatedAt, &req.User.ID, &req.User.Name,
			&req.User.Handle, &req.User.AvatarURL, &req.User.Bio); err != nil {
			return nil, err
		}
		list = append(list, req)
	}
	return list, rows.Err()
}

// handleListFriendRequests returns the inbox and the requests you have sent.
func (s *server) handleListFriendRequests(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)

	incoming, err := s.queryRequests(
		`SELECT f.id, f.created_at, `+publicUserColumns+`
		 FROM friendships f JOIN users u ON u.id = f.requester_id
		 WHERE f.addressee_id = $1 AND f.status = 'pending'
		 ORDER BY f.created_at DESC`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load requests")
		return
	}

	outgoing, err := s.queryRequests(
		`SELECT f.id, f.created_at, `+publicUserColumns+`
		 FROM friendships f JOIN users u ON u.id = f.addressee_id
		 WHERE f.requester_id = $1 AND f.status = 'pending'
		 ORDER BY f.created_at DESC`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load requests")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

type friendRequestBody struct {
	Handle string `json:"handle"`
	UserID int64  `json:"userId"`
}

// handleCreateFriendRequest sends a request by handle (typed or scanned) or by id.
func (s *server) handleCreateFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	var body friendRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var target PublicUser
	var err error
	if handle := normalizeHandle(body.Handle); handle != "" {
		err = scanPublicUser(s.db.QueryRow(
			`SELECT `+publicUserColumns+` FROM users u WHERE u.handle = $1`, handle), &target)
	} else if body.UserID > 0 {
		err = scanPublicUser(s.db.QueryRow(
			`SELECT `+publicUserColumns+` FROM users u WHERE u.id = $1`, body.UserID), &target)
	} else {
		writeError(w, http.StatusBadRequest, "IDを入力してください")
		return
	}
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "そのIDのユーザーは見つかりませんでした")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send request")
		return
	}

	relation, requestID, err := s.relationTo(userID, target.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send request")
		return
	}
	switch relation {
	case relationSelf:
		writeError(w, http.StatusBadRequest, "自分自身は追加できません")
		return
	case relationFriends:
		writeError(w, http.StatusConflict, "すでに友だちです")
		return
	case relationOutgoing:
		writeError(w, http.StatusConflict, "すでにリクエストを送っています")
		return
	case relationIncoming:
		// They asked first: taking the same action from this side just confirms it.
		if _, err := s.db.Exec(
			`UPDATE friendships SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = $1`,
			*requestID,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to accept request")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"relation": relationFriends, "user": target})
		return
	}

	if _, err := s.db.Exec(
		`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
		userID, target.ID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send request")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"relation": relationOutgoing, "user": target})
}

// handleAcceptFriendRequest confirms a request addressed to the signed-in member.
func (s *server) handleAcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id, err := atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request id")
		return
	}

	res, err := s.db.Exec(
		`UPDATE friendships SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
		 WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`, id, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to accept request")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "リクエストが見つかりませんでした")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteFriendRequest declines an incoming request or cancels one you sent.
func (s *server) handleDeleteFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id, err := atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request id")
		return
	}

	res, err := s.db.Exec(
		`DELETE FROM friendships
		 WHERE id = $1 AND status = 'pending' AND (addressee_id = $2 OR requester_id = $3)`,
		id, userID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update request")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "リクエストが見つかりませんでした")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveFriend breaks the connection in both directions.
func (s *server) handleRemoveFriend(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	id, err := atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	res, err := s.db.Exec(
		`DELETE FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $3 AND addressee_id = $4)`,
		userID, id, id, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove friend")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "友だちが見つかりませんでした")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
