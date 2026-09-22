package main

import "time"

type User struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	Handle    string  `json:"handle"`
	AvatarURL *string `json:"avatarUrl"`
	Bio       *string `json:"bio"`
	// RankPublic lets the member appear on the world leaderboard.
	RankPublic   bool      `json:"rankPublic"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// PublicUser is everything another member may see about someone.
type PublicUser struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Handle    string  `json:"handle"`
	AvatarURL *string `json:"avatarUrl"`
	Bio       *string `json:"bio"`
}

// Friend is a confirmed friend plus the counter shown on their card.
type Friend struct {
	PublicUser
	SpotCount int `json:"spotCount"`
}

// FriendRequest is one pending row, seen from the inbox or the sent list.
type FriendRequest struct {
	ID        int64      `json:"id"`
	User      PublicUser `json:"user"`
	CreatedAt time.Time  `json:"createdAt"`
}

// Media is one photo or short video attached to a place.
type Media struct {
	URL  string `json:"url"`
	Kind string `json:"kind"`
}

type Place struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"-"`
	Name        string  `json:"name"`
	Country     string  `json:"country"`
	CountryCode *string `json:"countryCode,omitempty"`
	Region      *string `json:"region,omitempty"`
	// Prefecture is the JIS code (1-47) for pins in Japan, 0 elsewhere; derived, never stored.
	Prefecture  int       `json:"prefecture,omitempty"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	VisitedDate *string   `json:"visitedDate,omitempty"`
	Notes       *string   `json:"notes,omitempty"`
	Media       []Media   `json:"media"`
	CreatedAt   time.Time `json:"createdAt"`
}
