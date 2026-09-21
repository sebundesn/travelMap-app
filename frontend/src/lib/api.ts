const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

import type {
  Friend,
  FriendRequests,
  Media,
  Place,
  PlaceInput,
  ProfileInput,
  RankMetric,
  RankScope,
  Rankings,
  Stats,
  User,
  UserLookup,
} from "./types";

async function readError(res: Response): Promise<never> {
  let message = res.statusText;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch {
    // ignore non-JSON error bodies
  }
  throw new ApiError(res.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) return readError(res);

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Turns a stored path such as `/uploads/abc.jpg` into a loadable URL. */
export function assetUrl(path?: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

export const api = {
  register: (email: string, password: string, name: string) =>
    request<User>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/me"),
  updateProfile: (patch: ProfileInput) =>
    request<User>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }),
  lookupUser: (handle: string) => request<UserLookup>(`/api/users/${encodeURIComponent(handle)}`),

  listFriends: () => request<Friend[]>("/api/friends"),
  removeFriend: (userId: number) => request<void>(`/api/friends/${userId}`, { method: "DELETE" }),
  listFriendRequests: () => request<FriendRequests>("/api/friends/requests"),
  sendFriendRequest: (handle: string) =>
    request<{ relation: string }>("/api/friends/requests", {
      method: "POST",
      body: JSON.stringify({ handle }),
    }),
  acceptFriendRequest: (id: number) =>
    request<void>(`/api/friends/requests/${id}/accept`, { method: "POST" }),
  dismissFriendRequest: (id: number) =>
    request<void>(`/api/friends/requests/${id}`, { method: "DELETE" }),

  stats: () => request<Stats>("/api/stats"),
  rankings: (scope: RankScope, metric: RankMetric) =>
    request<Rankings>(`/api/rankings?scope=${scope}&metric=${metric}`),

  listPlaces: () => request<Place[]>("/api/places"),
  createPlace: (place: PlaceInput) =>
    request<Place>("/api/places", { method: "POST", body: JSON.stringify(place) }),
  updatePlace: (id: number, place: PlaceInput) =>
    request<Place>(`/api/places/${id}`, { method: "PUT", body: JSON.stringify(place) }),
  deletePlace: (id: number) => request<void>(`/api/places/${id}`, { method: "DELETE" }),
  uploadMedia: async (file: Blob, filename: string): Promise<Media> => {
    const form = new FormData();
    form.append("file", file, filename);
    const res = await fetch(`${API_URL}/api/uploads`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) return readError(res);
    return (await res.json()) as Media;
  },
  uploadImage: async (file: Blob): Promise<string> => {
    const media = await api.uploadMedia(file, "photo.jpg");
    return media.url;
  },
};
