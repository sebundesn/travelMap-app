package main

import (
	"math"
	"testing"
	"time"
)

func TestPrefectureFor(t *testing.T) {
	cases := []struct {
		country, region string
		want            int
	}{
		{"JP", "東京都", 13},
		{"JP", "Tokyo", 13},
		{"JP", "Tokyo Metropolis", 13},
		{"JP", "京都府", 26},
		{"JP", "Kyoto Prefecture", 26},
		{"JP", "京都", 26},
		{"JP", "北海道", 1},
		{"jp", "Hokkaido", 1},
		{"JP", "Ōsaka Prefecture", 27},
		{"JP", "沖縄県", 47},
		{"JP", "", 0},
		{"FR", "Île-de-France", 0},
		{"US", "Tokyo", 0},
	}
	for _, c := range cases {
		if got := prefectureFor(c.country, c.region); got != c.want {
			t.Errorf("prefectureFor(%q, %q) = %d, want %d", c.country, c.region, got, c.want)
		}
	}
}

func TestEveryPrefectureResolvesFromBothSpellings(t *testing.T) {
	for i, p := range prefectures {
		for _, name := range []string{p[0], p[1]} {
			if got := prefectureFor("JP", name); got != i+1 {
				t.Errorf("prefectureFor(JP, %q) = %d, want %d", name, got, i+1)
			}
		}
	}
}

func TestHaversineTokyoOsaka(t *testing.T) {
	got := haversineKm(35.6812, 139.7671, 34.7025, 135.4959) // Tokyo Sta. -> Osaka Sta.
	if math.Abs(got-403) > 5 {
		t.Errorf("Tokyo-Osaka = %.1f km, want about 403", got)
	}
}

func TestComputeStats(t *testing.T) {
	now := time.Now()
	places := []statPlace{
		// Deliberately out of order: distance must follow the visit dates, not insertion.
		{CountryCode: "JP", Region: "大阪府", Lat: 34.7025, Lng: 135.4959, VisitedDate: "2024-05-03", CreatedAt: now},
		{CountryCode: "JP", Region: "東京都", Lat: 35.6812, Lng: 139.7671, VisitedDate: "2024-05-01", CreatedAt: now},
		{CountryCode: "JP", Region: "Tokyo", Lat: 35.6586, Lng: 139.7454, VisitedDate: "2024-05-02", CreatedAt: now},
		{CountryCode: "FR", Region: "Île-de-France", Lat: 48.8584, Lng: 2.2945, CreatedAt: now}, // undated
		{Lat: 0, Lng: 0, VisitedDate: "not-a-date", CreatedAt: now},                             // unresolved
	}
	st := computeStats(places)

	if st.Spots != 5 || st.Unresolved != 1 {
		t.Errorf("spots=%d unresolved=%d, want 5 and 1", st.Spots, st.Unresolved)
	}
	if len(st.Countries) != 2 || st.Countries[0] != "FR" || st.Countries[1] != "JP" {
		t.Errorf("countries = %v, want [FR JP]", st.Countries)
	}
	if len(st.Prefectures) != 2 || st.Prefectures[0] != 13 || st.Prefectures[1] != 27 {
		t.Errorf("prefectures = %v, want [13 27]", st.Prefectures)
	}
	if st.DatedSpots != 3 {
		t.Errorf("datedSpots = %d, want 3", st.DatedSpots)
	}
	// Tokyo Sta. -> Tokyo Tower (~3 km) -> Osaka Sta. (~400 km)
	if st.DistanceKm < 395 || st.DistanceKm > 410 {
		t.Errorf("distance = %.1f km, want roughly 400", st.DistanceKm)
	}
}

func TestComputeStatsEmpty(t *testing.T) {
	st := computeStats(nil)
	if st.Countries == nil || st.Prefectures == nil {
		t.Error("empty stats must serialise lists as [] not null")
	}
	if st.DistanceKm != 0 {
		t.Errorf("distance = %v, want 0", st.DistanceKm)
	}
}
