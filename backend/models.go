package main

import "time"

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Place struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"-"`
	Name        string  `json:"name"`
	Country     string  `json:"country"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	VisitedDate *string `json:"visitedDate,omitempty"`
	Notes       *string `json:"notes,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}
