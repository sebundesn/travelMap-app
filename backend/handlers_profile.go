package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

const publicUserColumns = `u.id, u.name, u.handle, u.avatar_url, u.bio`

func scanPublicUser(row interface{ Scan(...any) error }, u *PublicUser) error {
	return row.Scan(&u.ID, &u.Name, &u.Handle, &u.AvatarURL, &u.Bio)
}

// loadUser reads the full profile of the signed-in member.
func (s *server) loadUser(id int64) (User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, email, name, handle, avatar_url, bio, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Handle, &u.AvatarURL, &u.Bio, &u.CreatedAt)
	return u, err
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := s.loadUser(currentUserID(r))
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type profileRequest struct {
	Name      *string `json:"name"`
	Handle    *string `json:"handle"`
	AvatarURL *string `json:"avatarUrl"`
	Bio       *string `json:"bio"`
}

// handleUpdateMe patches whichever profile fields the request carries.
func (s *server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	var req profileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "名前を入力してください")
			return
		}
		if _, err := s.db.Exec(`UPDATE users SET name = ? WHERE id = ?`, name, userID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
	}

	if req.Handle != nil {
		handle := normalizeHandle(*req.Handle)
		if !validHandle(handle) {
			writeError(w, http.StatusBadRequest, "IDは半角英小文字・数字・_ の3〜20文字で入力してください")
			return
		}
		taken, err := handleTaken(s.db, handle, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
		if taken {
			writeError(w, http.StatusConflict, "このIDはすでに使われています")
			return
		}
		if _, err := s.db.Exec(`UPDATE users SET handle = ? WHERE id = ?`, handle, userID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
	}

	if req.AvatarURL != nil {
		avatar := strings.TrimSpace(*req.AvatarURL)
		if _, err := s.db.Exec(`UPDATE users SET avatar_url = ? WHERE id = ?`, nullable(avatar), userID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
	}

	if req.Bio != nil {
		bio := strings.TrimSpace(*req.Bio)
		if len([]rune(bio)) > 140 {
			writeError(w, http.StatusBadRequest, "ひとことは140文字までです")
			return
		}
		if _, err := s.db.Exec(`UPDATE users SET bio = ? WHERE id = ?`, nullable(bio), userID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
	}

	u, err := s.loadUser(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "updated but failed to load profile")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// handleLookupUser powers the "add by ID / QR" screen: who this is, and where we stand with them.
func (s *server) handleLookupUser(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r)
	handle := normalizeHandle(r.PathValue("handle"))
	if handle == "" {
		writeError(w, http.StatusBadRequest, "IDを入力してください")
		return
	}

	var u PublicUser
	err := scanPublicUser(s.db.QueryRow(
		`SELECT `+publicUserColumns+` FROM users u WHERE u.handle = ?`, handle,
	), &u)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "そのIDのユーザーは見つかりませんでした")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to look up user")
		return
	}

	relation, requestID, err := s.relationTo(userID, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to look up user")
		return
	}

	var spots int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM places WHERE user_id = ?`, u.ID).Scan(&spots)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":      u,
		"relation":  relation,
		"requestId": requestID,
		"spotCount": spots,
	})
}

func nullable(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
