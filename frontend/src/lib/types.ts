export type User = {
  id: number;
  email: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  /** Whether this member appears on the world leaderboard. */
  rankPublic: boolean;
};

/** What another member is allowed to see about someone. */
export type PublicUser = {
  id: number;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
};

export type Friend = PublicUser & {
  spotCount: number;
};

export type FriendRequest = {
  id: number;
  user: PublicUser;
  createdAt: string;
};

export type FriendRequests = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

/** Where you stand with the person whose profile you are looking at. */
export type Relation = "self" | "none" | "friends" | "incoming" | "outgoing";

export type UserLookup = {
  user: PublicUser;
  relation: Relation;
  requestId: number | null;
  spotCount: number;
};

export type ProfileInput = {
  name?: string;
  handle?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  rankPublic?: boolean;
};

export type MediaKind = "image" | "video";

/** One photo or short video in a place's album. */
export type Media = {
  url: string;
  kind: MediaKind;
};

export type Place = {
  id: number;
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2, e.g. "JP". Absent on pins saved before stats existed. */
  countryCode?: string | null;
  /** First-level administrative area from the geocoder, e.g. "東京都". */
  region?: string | null;
  lat: number;
  lng: number;
  visitedDate?: string | null;
  notes?: string | null;
  media: Media[];
  createdAt: string;
};

export type PlaceInput = {
  name: string;
  country: string;
  countryCode?: string | null;
  region?: string | null;
  lat: number;
  lng: number;
  visitedDate?: string | null;
  notes?: string | null;
  media: Media[];
};

export type PlaceHint = {
  lat: number;
  lng: number;
  name: string;
  country: string;
  countryCode: string;
  region: string;
};

/** The country / prefecture the geocoder resolved for a coordinate. */
export type ResolvedLocation = {
  country: string;
  countryCode: string;
  region: string;
};

export type Stats = {
  spots: number;
  /** ISO codes of every country visited. */
  countries: string[];
  /** JIS codes (1-47) of every prefecture visited. */
  prefectures: number[];
  distanceKm: number;
  /** Pins with a visit date, i.e. the ones the distance was built from. */
  datedSpots: number;
  /** Pins still waiting for a country lookup. */
  unresolved: number;
};

export type RankScope = "friends" | "world";
export type RankMetric = "countries" | "prefectures" | "distance" | "spots";

export type RankEntry = {
  rank: number;
  user: PublicUser;
  spots: number;
  countries: number;
  prefectures: number;
  distanceKm: number;
  isMe: boolean;
};

export type Rankings = {
  scope: RankScope;
  metric: RankMetric;
  /** Everyone on the board, even when `entries` is capped. */
  total: number;
  entries: RankEntry[];
  /** You, whether or not you made the cut. `rank` is 0 when you opted out of the world board. */
  me: RankEntry | null;
};
