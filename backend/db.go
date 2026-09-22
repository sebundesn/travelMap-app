package main

import (
	"database/sql"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openDB(connString string) (*sql.DB, error) {
	db, err := sql.Open("pgx", connString)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	if err := migrate(db); err != nil {
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
	CREATE TABLE IF NOT EXISTS users (
		id BIGSERIAL PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	);

	CREATE TABLE IF NOT EXISTS places (
		id BIGSERIAL PRIMARY KEY,
		user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		country TEXT NOT NULL,
		lat DOUBLE PRECISION NOT NULL,
		lng DOUBLE PRECISION NOT NULL,
		visited_date TEXT,
		notes TEXT,
		image_url TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	);

	CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);

	CREATE TABLE IF NOT EXISTS place_media (
		id BIGSERIAL PRIMARY KEY,
		place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
		url TEXT NOT NULL,
		kind TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0
	);

	CREATE INDEX IF NOT EXISTS idx_place_media_place ON place_media(place_id, position);

	CREATE TABLE IF NOT EXISTS friendships (
		id BIGSERIAL PRIMARY KEY,
		requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		addressee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		status TEXT NOT NULL DEFAULT 'pending',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		responded_at TIMESTAMPTZ
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
	CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
	`)
	if err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "places", "image_url", "TEXT"); err != nil {
		return err
	}
	for _, column := range []string{"country_code", "region"} {
		if err := addColumnIfMissing(db, "places", column, "TEXT"); err != nil {
			return err
		}
	}
	if err := addColumnIfMissing(db, "users", "rank_public", "BOOLEAN NOT NULL DEFAULT true"); err != nil {
		return err
	}
	for _, column := range []string{"handle", "avatar_url", "bio"} {
		if err := addColumnIfMissing(db, "users", column, "TEXT"); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle)`); err != nil {
		return err
	}
	if err := migrateLegacyImages(db); err != nil {
		return err
	}
	return backfillHandles(db)
}

// migrateLegacyImages moves the single photo older pins kept in places.image_url into the album table.
func migrateLegacyImages(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO place_media (place_id, url, kind, position)
		 SELECT id, image_url, 'image', 0 FROM places
		 WHERE image_url IS NOT NULL AND image_url != ''`,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE places SET image_url = NULL WHERE image_url IS NOT NULL`); err != nil {
		return err
	}
	return tx.Commit()
}

// backfillHandles gives accounts created before handles existed a public ID.
func backfillHandles(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, name FROM users WHERE handle IS NULL OR handle = ''`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pending struct {
		id   int64
		name string
	}
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.name); err != nil {
			return err
		}
		todo = append(todo, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range todo {
		handle, err := generateHandle(db, p.name)
		if err != nil {
			return err
		}
		if _, err := db.Exec(`UPDATE users SET handle = $1 WHERE id = $2`, handle, p.id); err != nil {
			return err
		}
	}
	return nil
}

// addColumnIfMissing keeps databases created before a column existed usable.
func addColumnIfMissing(db *sql.DB, table, column, decl string) error {
	_, err := db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN IF NOT EXISTS ` + column + ` ` + decl)
	return err
}
