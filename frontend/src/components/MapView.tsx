"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { coverOf } from "@/lib/media";
import MediaThumb from "./MediaThumb";
import { animateCamera, cancelCameraAnimation, type LatLng } from "@/lib/mapCamera";
import { locationFromComponents } from "@/lib/region";
import type { Place, PlaceHint, ResolvedLocation } from "@/lib/types";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 };

function hasGeolocation() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

const WORLD_CENTER: LatLng = { lat: 35.6812, lng: 139.7671 };
const WORLD_ZOOM = 3;
const HOME_ZOOM = 15;
const TAP_ZOOM = 17;

/** Lift the camera so the bottom sheet never sits on top of the tapped pin. */
function sheetLift(open: boolean) {
  if (typeof window === "undefined" || !open) return 0;
  return Math.round(window.innerHeight * 0.2);
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
      </g>
    </svg>
  );
}

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "📍";
}

function PlacePin({
  place,
  selected,
  onClick,
}: {
  place: Place;
  selected: boolean;
  onClick: () => void;
}) {
  const cover = coverOf(place.media);

  return (
    <AdvancedMarker
      position={{ lat: place.lat, lng: place.lng }}
      zIndex={selected ? 20 : 1}
      onClick={onClick}
    >
      <div className={`pin${selected ? " pin-selected" : ""}`}>
        <div className="pin-bubble">
          {cover ? (
            <MediaThumb media={cover} />
          ) : (
            <span className="pin-initial">{initialOf(place.name)}</span>
          )}
        </div>
        <span className="pin-label">{place.name}</span>
      </div>
    </AdvancedMarker>
  );
}

function DraftPin({ position }: { position: LatLng }) {
  return (
    <AdvancedMarker position={position} zIndex={30}>
      <div className="pin pin-draft">
        <div className="pin-bubble">
          <span className="pin-initial">＋</span>
        </div>
      </div>
    </AdvancedMarker>
  );
}

function MeMarker({ position }: { position: LatLng }) {
  return (
    <AdvancedMarker position={position} zIndex={10}>
      <div className="me-marker">
        <span className="me-marker-pulse" />
        <span className="me-marker-dot" />
      </div>
    </AdvancedMarker>
  );
}

/** Keeps the camera in sync with what the sheet is showing. */
function CameraController({
  target,
  sheetOpen,
  home,
}: {
  target: LatLng | null;
  sheetOpen: boolean;
  home: LatLng | null;
}) {
  const map = useMap();
  const homeDone = useRef(false);

  useEffect(() => {
    if (!map || !home || homeDone.current) return;
    homeDone.current = true;
    animateCamera(map, home, HOME_ZOOM, { duration: 1400 });
  }, [map, home]);

  useEffect(() => {
    if (!map || !target) return;
    const zoom = Math.max(map.getZoom() ?? 0, TAP_ZOOM);
    animateCamera(map, target, zoom, { offsetY: sheetLift(sheetOpen) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, target?.lat, target?.lng, sheetOpen]);

  useEffect(() => {
    if (!map) return;
    return () => cancelCameraAnimation(map);
  }, [map]);

  return null;
}

/** Reverse-geocodes a tapped point so the form can prefill title and country. */
function PlaceResolver({
  request,
  onResolved,
}: {
  request: { lat: number; lng: number; placeId?: string } | null;
  onResolved: (hint: PlaceHint) => void;
}) {
  const geocoding = useMapsLibrary("geocoding");

  useEffect(() => {
    if (!geocoding || !request) return;
    let active = true;
    const geocoder = new geocoding.Geocoder();
    const query: google.maps.GeocoderRequest = request.placeId
      ? { placeId: request.placeId }
      : { location: { lat: request.lat, lng: request.lng } };

    geocoder
      .geocode(query)
      .then(({ results }) => {
        if (!active || results.length === 0) return;
        const result = results[0];
        const components = result.address_components ?? [];
        const find = (type: string) => components.find((c) => c.types.includes(type))?.long_name;
        const name =
          (request.placeId ? components[0]?.long_name : undefined) ??
          find("point_of_interest") ??
          find("premise") ??
          find("sublocality") ??
          find("locality") ??
          find("administrative_area_level_1") ??
          result.formatted_address.split(",")[0] ??
          "";
        onResolved({
          lat: request.lat,
          lng: request.lng,
          name: name.trim(),
          ...locationFromComponents(components),
        });
      })
      .catch(() => {
        // a failed lookup just means the user types the title themselves
      });

    return () => {
      active = false;
    };
  }, [geocoding, request, onResolved]);

  return null;
}

const BACKFILL_GAP_MS = 250;

/**
 * Pins saved before stats existed have no country code or prefecture. Looks them
 * up one at a time (gently, to stay inside the geocoder's rate limit) and hands
 * each result back to be saved.
 */
function LocationBackfill({
  places,
  onResolved,
}: {
  places: Place[];
  onResolved: (place: Place, location: ResolvedLocation) => void;
}) {
  const geocoding = useMapsLibrary("geocoding");
  // A pin the geocoder can't resolve (open sea, say) is tried once per visit, not in a loop.
  const attempted = useRef(new Set<number>());

  useEffect(() => {
    if (!geocoding) return;
    let active = true;
    const geocoder = new geocoding.Geocoder();

    (async () => {
      for (const place of places) {
        if (!active) return;
        if (place.countryCode || attempted.current.has(place.id)) continue;
        attempted.current.add(place.id);
        try {
          const { results } = await geocoder.geocode({ location: { lat: place.lat, lng: place.lng } });
          const location = locationFromComponents(results[0]?.address_components);
          if (location.countryCode) onResolved(place, location);
        } catch {
          // no result for this coordinate; the pin just stays uncounted
        }
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_GAP_MS));
      }
    })();

    return () => {
      active = false;
    };
  }, [geocoding, places, onResolved]);

  return null;
}

function SearchPill({ onSelect }: { onSelect: (hint: PlaceHint) => void }) {
  const placesLib = useMapsLibrary("places");
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      fields: ["geometry", "name", "address_components"],
    });
    const listener = autocomplete.addListener("place_changed", () => {
      const result = autocomplete.getPlace();
      const location = result.geometry?.location;
      if (!location) return;
      onSelect({
        lat: location.lat(),
        lng: location.lng(),
        name: result.name ?? "",
        ...locationFromComponents(result.address_components),
      });
      if (inputRef.current) inputRef.current.value = "";
      inputRef.current?.blur();
      setOpen(false);
    });
    return () => {
      listener.remove();
      google.maps.event.clearInstanceListeners(autocomplete);
    };
  }, [placesLib, onSelect]);

  return (
    <div className={`search-pill${open ? " search-pill-open" : ""}`}>
      <span className="search-icon" aria-hidden>
        🔍
      </span>
      <input
        ref={inputRef}
        type="text"
        placeholder="場所を検索"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
    </div>
  );
}

export default function MapView({
  places,
  selectedPlace,
  draft,
  sheetOpen,
  onMapTap,
  onPlaceTap,
  onHint,
  onLocationResolved,
}: {
  places: Place[];
  selectedPlace: Place | null;
  draft: LatLng | null;
  sheetOpen: boolean;
  onMapTap: (location: LatLng) => void;
  onPlaceTap: (place: Place) => void;
  onHint: (hint: PlaceHint) => void;
  onLocationResolved: (place: Place, location: ResolvedLocation) => void;
}) {
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(() => hasGeolocation());
  const [geoError, setGeoError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ lat: number; lng: number; placeId?: string } | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);

  // First fix on mount: the map opens centred on where you are.
  useEffect(() => {
    if (!hasGeolocation()) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!active) return;
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        if (active) setLocating(false);
      },
      GEO_OPTIONS
    );
    return () => {
      active = false;
    };
  }, []);

  const locate = useCallback(() => {
    if (!hasGeolocation()) {
      setGeoError("この端末では現在地を取得できません");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
        setLocating(false);
        setRecenterKey((k) => k + 1);
      },
      () => {
        setLocating(false);
        setGeoError("現在地を取得できませんでした");
      },
      GEO_OPTIONS
    );
  }, []);

  const handleSearchSelect = useCallback(
    (hint: PlaceHint) => {
      onMapTap({ lat: hint.lat, lng: hint.lng });
      onHint(hint);
    },
    [onMapTap, onHint]
  );

  const target = draft ?? (selectedPlace ? { lat: selectedPlace.lat, lng: selectedPlace.lng } : null);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="center-screen">
        .env.local に NEXT_PUBLIC_GOOGLE_MAPS_API_KEY を設定してください。
      </div>
    );
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} language="ja" region="JP">
      <Map
        className="map-canvas"
        defaultCenter={WORLD_CENTER}
        defaultZoom={WORLD_ZOOM}
        minZoom={2}
        mapId={GOOGLE_MAPS_MAP_ID}
        disableDefaultUI
        clickableIcons
        gestureHandling="greedy"
        onClick={(e) => {
          const latLng = e.detail.latLng;
          if (!latLng) return;
          if (e.detail.placeId) e.stop();
          setLookup({ lat: latLng.lat, lng: latLng.lng, placeId: e.detail.placeId ?? undefined });
          onMapTap({ lat: latLng.lat, lng: latLng.lng });
        }}
      >
        <CameraController target={target} sheetOpen={sheetOpen} home={me} />
        <PlaceResolver request={lookup} onResolved={onHint} />
        <LocationBackfill places={places} onResolved={onLocationResolved} />

        {me && <MeMarker position={me} />}
        {places.map((place) => (
          <PlacePin
            key={place.id}
            place={place}
            selected={selectedPlace?.id === place.id}
            onClick={() => onPlaceTap(place)}
          />
        ))}
        {draft && <DraftPin position={draft} />}
      </Map>

      <div className="map-overlay map-overlay-top">
        <SearchPill onSelect={handleSearchSelect} />
      </div>

      <div className="map-overlay map-overlay-right">
        {geoError && <div className="toast">{geoError}</div>}
        <button
          type="button"
          className="round-btn"
          onClick={() => {
            if (me) setRecenterKey((k) => k + 1);
            locate();
          }}
          disabled={locating}
          aria-label="現在地に戻る"
        >
          {locating ? <span className="spinner" /> : <LocateIcon />}
        </button>
      </div>

      <RecenterOnDemand me={me} trigger={recenterKey} sheetOpen={sheetOpen} />
    </APIProvider>
  );
}

/** Recentering lives outside <Map> so the locate button can reuse the same glide. */
function RecenterOnDemand({
  me,
  trigger,
  sheetOpen,
}: {
  me: LatLng | null;
  trigger: number;
  sheetOpen: boolean;
}) {
  const map = useMap();
  const lastTrigger = useRef(0);

  useEffect(() => {
    if (!map || !me || trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    animateCamera(map, me, Math.max(map.getZoom() ?? 0, HOME_ZOOM), { offsetY: sheetLift(sheetOpen) });
  }, [map, me, trigger, sheetOpen]);

  return null;
}
