package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
)

type server struct {
	db        *sql.DB
	jwtSecret []byte
	origin    string
	uploadDir string
}

func main() {
	dbPath := getenv("DB_PATH", "./travelmap.db")
	port := getenv("PORT", "8080")
	origin := getenv("FRONTEND_ORIGIN", "http://localhost:3000")
	secret := getenv("JWT_SECRET", "dev-secret-change-me")
	uploadDir := getenv("UPLOAD_DIR", "./uploads")

	db, err := openDB(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	s := &server{db: db, jwtSecret: []byte(secret), origin: origin, uploadDir: uploadDir}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("PATCH /api/me", s.requireAuth(s.handleUpdateMe))
	mux.HandleFunc("GET /api/users/{handle}", s.requireAuth(s.handleLookupUser))

	mux.HandleFunc("GET /api/friends", s.requireAuth(s.handleListFriends))
	mux.HandleFunc("DELETE /api/friends/{id}", s.requireAuth(s.handleRemoveFriend))
	mux.HandleFunc("GET /api/friends/places", s.requireAuth(s.handleListFriendPlaces))
	mux.HandleFunc("GET /api/friends/requests", s.requireAuth(s.handleListFriendRequests))
	mux.HandleFunc("POST /api/friends/requests", s.requireAuth(s.handleCreateFriendRequest))
	mux.HandleFunc("POST /api/friends/requests/{id}/accept", s.requireAuth(s.handleAcceptFriendRequest))
	mux.HandleFunc("DELETE /api/friends/requests/{id}", s.requireAuth(s.handleDeleteFriendRequest))

	mux.HandleFunc("GET /api/stats", s.requireAuth(s.handleMyStats))
	mux.HandleFunc("GET /api/rankings", s.requireAuth(s.handleRankings))

	mux.HandleFunc("GET /api/places", s.requireAuth(s.handleListPlaces))
	mux.HandleFunc("POST /api/places", s.requireAuth(s.handleCreatePlace))
	mux.HandleFunc("PUT /api/places/{id}", s.requireAuth(s.handleUpdatePlace))
	mux.HandleFunc("DELETE /api/places/{id}", s.requireAuth(s.handleDeletePlace))

	mux.HandleFunc("POST /api/uploads", s.requireAuth(s.handleUpload))
	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))

	log.Printf("travelmap backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, s.withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", s.origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
