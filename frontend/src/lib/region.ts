import type { ResolvedLocation } from "./types";

/** Pulls country, ISO code and first-level area out of geocoder address components. */
export function locationFromComponents(
  components: google.maps.GeocoderAddressComponent[] | undefined
): ResolvedLocation {
  const find = (type: string) => components?.find((c) => c.types.includes(type));
  const country = find("country");
  return {
    country: country?.long_name ?? "",
    countryCode: country?.short_name ?? "",
    region: find("administrative_area_level_1")?.long_name ?? "",
  };
}

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["ja"], { type: "region" })
    : null;

/** "JP" -> "日本". Falls back to the code when the runtime doesn't know it. */
export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "JP" -> 🇯🇵 (regional-indicator pair). */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Countries recognised by the UN plus the two observer states, the usual "all countries" total. */
export const WORLD_COUNTRY_COUNT = 195;

/**
 * Japan's 47 prefectures in JIS order (code = index + 1) with a position on a
 * tile-grid map, laid out roughly north-east to south-west.
 */
const PREFECTURE_TILES: ReadonlyArray<readonly [short: string, x: number, y: number]> = [
  ["北海道", 12, 0], ["青森", 12, 1], ["岩手", 12, 2], ["宮城", 12, 3],
  ["秋田", 11, 2], ["山形", 11, 3], ["福島", 11, 4], ["茨城", 12, 5],
  ["栃木", 11, 5], ["群馬", 10, 5], ["埼玉", 10, 6], ["千葉", 12, 6],
  ["東京", 11, 6], ["神奈川", 9, 7], ["新潟", 10, 4], ["富山", 8, 5],
  ["石川", 7, 5], ["福井", 6, 6], ["山梨", 9, 6], ["長野", 9, 5],
  ["岐阜", 7, 6], ["静岡", 8, 7], ["愛知", 8, 6], ["三重", 7, 7],
  ["滋賀", 6, 7], ["京都", 5, 7], ["大阪", 4, 8], ["兵庫", 4, 7],
  ["奈良", 5, 8], ["和歌山", 5, 9], ["鳥取", 3, 7], ["島根", 2, 7],
  ["岡山", 3, 8], ["広島", 2, 8], ["山口", 1, 8], ["徳島", 4, 9],
  ["香川", 3, 9], ["愛媛", 2, 9], ["高知", 3, 10], ["福岡", 1, 9],
  ["佐賀", 0, 9], ["長崎", 0, 10], ["熊本", 1, 10], ["大分", 2, 10],
  ["宮崎", 2, 11], ["鹿児島", 1, 11], ["沖縄", 0, 12],
];

export const PREFECTURE_COUNT = PREFECTURE_TILES.length;

export type PrefectureTile = {
  code: number;
  /** Full name, e.g. "東京都". */
  name: string;
  /** Two characters, small enough to sit inside a tile. */
  label: string;
  x: number;
  y: number;
};

function suffixFor(code: number) {
  if (code === 1) return "";
  if (code === 13) return "都";
  return code === 26 || code === 27 ? "府" : "県";
}

export const PREFECTURES: PrefectureTile[] = PREFECTURE_TILES.map(([short, x, y], i) => ({
  code: i + 1,
  name: short + suffixFor(i + 1),
  label: [...short].slice(0, 2).join(""),
  x,
  y,
}));

export const TILE_COLUMNS = Math.max(...PREFECTURES.map((p) => p.x)) + 1;
export const TILE_ROWS = Math.max(...PREFECTURES.map((p) => p.y)) + 1;
