package main

import "strings"

// prefectures lists Japan's 47 prefectures in JIS order (code = index + 1).
// Each entry is [short Japanese name, lowercase romaji], the two spellings the
// geocoder may return for administrative_area_level_1 depending on language.
var prefectures = [47][2]string{
	{"北海道", "hokkaido"}, {"青森", "aomori"}, {"岩手", "iwate"}, {"宮城", "miyagi"},
	{"秋田", "akita"}, {"山形", "yamagata"}, {"福島", "fukushima"}, {"茨城", "ibaraki"},
	{"栃木", "tochigi"}, {"群馬", "gunma"}, {"埼玉", "saitama"}, {"千葉", "chiba"},
	{"東京", "tokyo"}, {"神奈川", "kanagawa"}, {"新潟", "niigata"}, {"富山", "toyama"},
	{"石川", "ishikawa"}, {"福井", "fukui"}, {"山梨", "yamanashi"}, {"長野", "nagano"},
	{"岐阜", "gifu"}, {"静岡", "shizuoka"}, {"愛知", "aichi"}, {"三重", "mie"},
	{"滋賀", "shiga"}, {"京都", "kyoto"}, {"大阪", "osaka"}, {"兵庫", "hyogo"},
	{"奈良", "nara"}, {"和歌山", "wakayama"}, {"鳥取", "tottori"}, {"島根", "shimane"},
	{"岡山", "okayama"}, {"広島", "hiroshima"}, {"山口", "yamaguchi"}, {"徳島", "tokushima"},
	{"香川", "kagawa"}, {"愛媛", "ehime"}, {"高知", "kochi"}, {"福岡", "fukuoka"},
	{"佐賀", "saga"}, {"長崎", "nagasaki"}, {"熊本", "kumamoto"}, {"大分", "oita"},
	{"宮崎", "miyazaki"}, {"鹿児島", "kagoshima"}, {"沖縄", "okinawa"},
}

var prefectureByName = func() map[string]int {
	m := make(map[string]int, len(prefectures)*2)
	for i, p := range prefectures {
		m[p[0]] = i + 1
		m[p[1]] = i + 1
	}
	return m
}()

var romajiFold = strings.NewReplacer("ō", "o", "ū", "u", "Ō", "o", "Ū", "u")

// normalizeRegion strips the administrative suffix so "東京都", "Tokyo Metropolis"
// and "Tokyo" all compare equal.
func normalizeRegion(raw string) string {
	s := strings.ToLower(romajiFold.Replace(strings.TrimSpace(raw)))
	for _, suffix := range []string{" prefecture", " metropolis"} {
		s = strings.TrimSuffix(s, suffix)
	}
	runes := []rune(s)
	// "京都" and "東京" are complete names; only 3+ character names carry a 都/府/県 suffix.
	if len(runes) >= 3 {
		switch runes[len(runes)-1] {
		case '都', '府', '県':
			s = string(runes[:len(runes)-1])
		}
	}
	return s
}

// prefectureFor returns the JIS code (1-47) of a Japanese region, or 0 when the
// place is abroad or the region is unknown.
func prefectureFor(countryCode, region string) int {
	if !strings.EqualFold(countryCode, "JP") {
		return 0
	}
	return prefectureByName[normalizeRegion(region)]
}
