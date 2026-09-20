package main

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
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
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS places (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		country TEXT NOT NULL,
		lat REAL NOT NULL,
		lng REAL NOT NULL,
		visited_date TEXT,
		notes TEXT,
		image_url TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);

	CREATE TABLE IF NOT EXISTS friendships (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		status TEXT NOT NULL DEFAULT 'pending',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		responded_at DATETIME
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
	for _, column := range []string{"handle", "avatar_url", "bio"} {
		if err := addColumnIfMissing(db, "users", column, "TEXT"); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle)`); err != nil {
		return err
	}
	return backfillHandles(db)
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
		if _, err := db.Exec(`UPDATE users SET handle = ? WHERE id = ?`, handle, p.id); err != nil {
			return err
		}
	}
	return nil
}

// addColumnIfMissing keeps databases created before a column existed usable.
func addColumnIfMissing(db *sql.DB, table, column, decl string) error {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + decl)
	return err
}
