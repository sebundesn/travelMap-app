"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { Place, PlaceHint, ResolvedLocation } from "@/lib/types";
import Avatar from "@/components/Avatar";
import BottomSheet from "@/components/BottomSheet";
import PlaceSheet, { type PlaceValues, type SheetState } from "@/components/PlaceSheet";
import PlaceStrip from "@/components/PlaceStrip";
import { Loading } from "@/components/StatusView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const SHEET_EXIT_MS = 300;

function toInput(values: PlaceValues, lat: number, lng: number) {
  return {
    name: values.name,
    country: values.country,
    countryCode: values.countryCode || null,
    region: values.region || null,
    lat,
    lng,
    visitedDate: values.visitedDate || null,
    notes: values.notes.trim() || null,
    media: values.media,
  };
}

export default function Home() {
  const { user, loading } = useAuth();
  const [places, setPlaces] = useState<Place[]>([]);
  const [pending, setPending] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [closing, setClosing] = useState(false);
  const [hint, setHint] = useState<PlaceHint | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The sheet stays mounted while it slides away, then clears itself.
  const closeSheet = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setSheet(null);
      setClosing(false);
      closeTimer.current = null;
    }, SHEET_EXIT_MS);
  }, []);

  const openSheet = useCallback((next: SheetState) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setSheet(next);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.listPlaces().then(setPlaces).catch(() => setPlaces([]));
    api
      .listFriendRequests()
      .then((r) => setPending(r.incoming.length))
      .catch(() => setPending(0));
  }, [user]);

  const handleMapTap = useCallback(
    (location: { lat: number; lng: number }) => {
      setHint(null);
      openSheet({ mode: "create", lat: location.lat, lng: location.lng });
    },
    [openSheet]
  );

  const handleHint = useCallback((next: PlaceHint) => setHint(next), []);
  const handlePlaceTap = useCallback(
    (place: Place) => {
      setHint(null);
      openSheet({ mode: "detail", place });
    },
    [openSheet]
  );

  // Saves the country / prefecture found for an older pin so it counts toward the stats.
  const handleLocationResolved = useCallback(async (place: Place, location: ResolvedLocation) => {
    try {
      const updated = await api.updatePlace(place.id, {
        name: place.name,
        country: place.country || location.country,
        countryCode: location.countryCode,
        region: location.region || null,
        lat: place.lat,
        lng: place.lng,
        visitedDate: place.visitedDate ?? null,
        notes: place.notes ?? null,
        media: place.media,
      });
      setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      // deleted meanwhile, or offline: it is retried on the next visit
    }
  }, []);

  async function handleCreate(values: PlaceValues) {
    if (sheet?.mode !== "create") return;
    const created = await api.createPlace(toInput(values, sheet.lat, sheet.lng));
    setPlaces((prev) => [created, ...prev]);
    openSheet({ mode: "detail", place: created });
  }

  async function handleUpdate(place: Place, values: PlaceValues) {
    const updated = await api.updatePlace(place.id, toInput(values, place.lat, place.lng));
    setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    openSheet({ mode: "detail", place: updated });
  }

  async function handleDelete(place: Place) {
    if (!window.confirm(`「${place.name}」を削除しますか？`)) return;
    setPlaces((prev) => prev.filter((p) => p.id !== place.id));
    closeSheet();
    await api.deletePlace(place.id).catch(() => {
      api.listPlaces().then(setPlaces);
    });
  }

  if (loading) {
    return <Loading />;
  }

  if (!user) {
    return (
      <div className="center-screen">
        <div className="auth-prompt">
          <h1>TravelMap</h1>
          <p>行った場所を、地図に残そう。</p>
          <div className="auth-prompt-links">
            <Link href="/login" className="btn btn-primary">
              ログイン
            </Link>
            <Link href="/register" className="btn btn-ghost">
              新規登録
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const sheetOpen = sheet !== null && !closing;
  const selectedPlace = sheet && sheet.mode !== "create" ? sheet.place : null;
  const draft = sheet?.mode === "create" && !closing ? { lat: sheet.lat, lng: sheet.lng } : null;

  return (
    <div className="app">
      <MapView
        places={places}
        selectedPlace={selectedPlace}
        draft={draft}
        sheetOpen={sheetOpen}
        onMapTap={handleMapTap}
        onPlaceTap={handlePlaceTap}
        onHint={handleHint}
        onLocationResolved={handleLocationResolved}
      />

      <div className="map-overlay map-overlay-header">
        <Link href="/profile" className="profile-pill">
          <Avatar name={user.name} avatarUrl={user.avatarUrl} />
          <span className="profile-text">
            <strong>{user.name}</strong>
            <small>{places.length} spots ・ @{user.handle}</small>
          </span>
        </Link>
        <Link href="/friends" className="round-btn" aria-label="友だち">
          <span aria-hidden>👥</span>
          {pending > 0 && <span className="badge badge-dot">{pending}</span>}
        </Link>
      </div>

      <PlaceStrip places={places} onSelect={handlePlaceTap} hidden={sheetOpen} />

      {sheet && (
        <BottomSheet open={sheetOpen} onClose={closeSheet}>
          <PlaceSheet
            state={sheet}
            hint={hint}
            onClose={closeSheet}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onEdit={(place) => openSheet({ mode: "edit", place })}
          />
        </BottomSheet>
      )}
    </div>
  );
}
