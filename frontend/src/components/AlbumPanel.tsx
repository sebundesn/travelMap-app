"use client";

import { useEffect, useMemo, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import DetailMedia from "@/components/DetailMedia";
import MediaThumb from "@/components/MediaThumb";
import { ErrorView, Loading } from "@/components/StatusView";
import { useSheet } from "@/components/useSheet";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { coverOf } from "@/lib/media";
import { PREFECTURES, countryName, flagEmoji } from "@/lib/region";
import type { Place } from "@/lib/types";

type Grouping = "date" | "prefecture" | "country";

const GROUPINGS: { id: Grouping; label: string }[] = [
  { id: "date", label: "日付順" },
  { id: "prefecture", label: "都道府県" },
  { id: "country", label: "国別" },
];

type Group = { key: string; title: string; icon?: string; places: Place[] };

/** Newest visit first; pins without a date fall back to when they were saved. */
function byRecency(a: Place, b: Place) {
  const left = a.visitedDate || a.createdAt;
  const right = b.visitedDate || b.createdAt;
  return right.localeCompare(left);
}

function groupByDate(places: Place[]): Group[] {
  const months = new Map<string, Place[]>();
  const undated: Place[] = [];
  for (const place of places) {
    const month = place.visitedDate?.slice(0, 7);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      undated.push(place);
      continue;
    }
    months.set(month, [...(months.get(month) ?? []), place]);
  }
  const groups: Group[] = [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => {
      const [y, m] = month.split("-");
      return { key: month, title: `${y}年${Number(m)}月`, places: list.sort(byRecency) };
    });
  if (undated.length > 0) {
    groups.push({ key: "undated", title: "日付なし", places: undated.sort(byRecency) });
  }
  return groups;
}

function groupByPrefecture(places: Place[]): Group[] {
  const groups: Group[] = [];
  for (const pref of PREFECTURES) {
    const list = places.filter((p) => p.prefecture === pref.code);
    if (list.length > 0) {
      groups.push({ key: `pref-${pref.code}`, title: pref.name, places: list.sort(byRecency) });
    }
  }
  const other = places.filter((p) => !p.prefecture);
  if (other.length > 0) {
    groups.push({ key: "other", title: "海外・その他", icon: "🌏", places: other.sort(byRecency) });
  }
  return groups;
}

function groupByCountry(places: Place[]): Group[] {
  const countries = new Map<string, Place[]>();
  const unknown: Place[] = [];
  for (const place of places) {
    const code = place.countryCode;
    if (!code) {
      unknown.push(place);
      continue;
    }
    countries.set(code, [...(countries.get(code) ?? []), place]);
  }
  const groups: Group[] = [...countries.entries()]
    .map(([code, list]) => ({
      key: code,
      title: countryName(code),
      icon: flagEmoji(code),
      places: list.sort(byRecency),
    }))
    .sort((a, b) => b.places.length - a.places.length || a.title.localeCompare(b.title, "ja"));
  if (unknown.length > 0) {
    groups.push({ key: "unknown", title: "国不明", icon: "🏳️", places: unknown.sort(byRecency) });
  }
  return groups;
}

function AlbumCard({ place, onOpen }: { place: Place; onOpen: () => void }) {
  const cover = coverOf(place.media);
  const date = formatDate(place.visitedDate);
  return (
    <button type="button" className="album-card" onClick={onOpen}>
      <span className="album-thumb">
        {cover && <MediaThumb media={cover} />}
        {place.media.length > 1 && <span className="album-count">{place.media.length}</span>}
        {cover?.kind === "video" && place.media.length === 1 && (
          <span className="album-count" aria-label="動画">
            ▶
          </span>
        )}
      </span>
      <span className="album-name">{place.name}</span>
      {date && <span className="album-date">{date}</span>}
    </button>
  );
}

/** The album view of the diary: every place that has photos or videos, grouped three ways. */
export default function AlbumPanel() {
  const { user } = useAuth();
  const sheet = useSheet();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>("date");
  const [selected, setSelected] = useState<Place | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .listPlaces()
      .then(setPlaces)
      .catch(() => setFailed(true));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const withMedia = useMemo(() => (places ?? []).filter((p) => p.media.length > 0), [places]);
  const groups = useMemo(() => {
    switch (grouping) {
      case "prefecture":
        return groupByPrefecture(withMedia);
      case "country":
        return groupByCountry(withMedia);
      default:
        return groupByDate(withMedia);
    }
  }, [grouping, withMedia]);

  if (failed) return <ErrorView inline message="アルバムを読み込めませんでした" />;
  if (!places) return <Loading inline />;

  const photoCount = withMedia.reduce((sum, p) => sum + p.media.length, 0);

  return (
    <>
      <div className="chip-row" role="tablist" aria-label="並び方">
        {GROUPINGS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={grouping === g.id}
            className={grouping === g.id ? "chip chip-on" : "chip"}
            onClick={() => setGrouping(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {withMedia.length === 0 ? (
        <section className="card">
          <p className="card-note">
            まだ写真や動画がありません。地図で場所を記録するときに追加すると、ここに並びます。
          </p>
        </section>
      ) : (
        <>
          <p className="album-summary">
            {withMedia.length}か所 ・ {photoCount}件
          </p>
          {groups.map((group) => (
            <section key={group.key} className="card">
              <div className="card-head">
                <h2 className="card-title">
                  {group.icon && <span aria-hidden>{group.icon} </span>}
                  {group.title}
                </h2>
                <span className="card-count">{group.places.length}</span>
              </div>
              <div className="album-grid">
                {group.places.map((place) => (
                  <AlbumCard
                    key={place.id}
                    place={place}
                    onOpen={() => {
                      setSelected(place);
                      sheet.show();
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {sheet.mounted && selected && (
        <BottomSheet open={sheet.open} onClose={sheet.hide}>
          <div className="detail">
            <DetailMedia media={selected.media} title={selected.name} />
            <div className="detail-head">
              <h2>{selected.name}</h2>
              {(selected.country || selected.visitedDate) && (
                <p className="detail-meta">
                  {[selected.country, formatDate(selected.visitedDate)].filter(Boolean).join(" ・ ")}
                </p>
              )}
            </div>
            {selected.notes && <p className="detail-notes">{selected.notes}</p>}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
