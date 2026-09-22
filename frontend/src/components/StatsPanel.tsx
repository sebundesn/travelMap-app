"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  PREFECTURES,
  PREFECTURE_COUNT,
  TILE_COLUMNS,
  WORLD_COUNTRY_COUNT,
  countryName,
  flagEmoji,
} from "@/lib/region";
import type { Stats } from "@/lib/types";
import { Loading, ErrorView } from "@/components/StatusView";

const EARTH_CIRCUMFERENCE_KM = 40075;
const MOON_DISTANCE_KM = 384400;

function formatKm(km: number) {
  return Math.round(km).toLocaleString("ja-JP");
}

function percent(part: number, whole: number) {
  return Math.min(100, (part / whole) * 100);
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="presentation">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function PrefectureMap({ visited }: { visited: Set<number> }) {
  return (
    <div className="tile-map" style={{ gridTemplateColumns: `repeat(${TILE_COLUMNS}, 1fr)` }}>
      {PREFECTURES.map((p) => (
        <span
          key={p.code}
          className={`tile${visited.has(p.code) ? " tile-on" : ""}`}
          style={{ gridColumn: p.x + 1, gridRow: p.y + 1 }}
          title={`${p.name}${visited.has(p.code) ? "（制覇）" : ""}`}
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** 旅の記録: countries, prefectures and distance travelled. */
export default function StatsPanel({ onShowRanking }: { onShowRanking: () => void }) {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    api
      .stats()
      .then(setStats)
      .catch(() => setFailed(true));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visited = useMemo(() => new Set(stats?.prefectures ?? []), [stats]);
  const countries = useMemo(
    () =>
      (stats?.countries ?? [])
        .map((code) => ({ code, name: countryName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [stats]
  );

  return (
    <>
      {failed && <ErrorView inline message="記録を読み込めませんでした" />}
      {!stats && !failed && <Loading inline label="集計中…" />}

      {stats && (
        <>
          <section className="card">
            <div className="hero-stats">
              <div>
                <strong>{stats.countries.length}</strong>
                <small>訪れた国</small>
              </div>
              <div>
                <strong>{stats.prefectures.length}</strong>
                <small>制覇した都道府県</small>
              </div>
              <div>
                <strong>{formatKm(stats.distanceKm)}</strong>
                <small>総移動距離 km</small>
              </div>
            </div>
            {stats.unresolved > 0 && (
              <p className="card-note">
                {stats.unresolved}件の場所はまだ国を判定できていません。地図画面を開いておくと自動で補完されます。
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">都道府県</h2>
              <span className="card-count">
                {stats.prefectures.length} / {PREFECTURE_COUNT}
              </span>
            </div>
            <Progress value={percent(stats.prefectures.length, PREFECTURE_COUNT)} />
            <PrefectureMap visited={visited} />
            {stats.prefectures.length === PREFECTURE_COUNT && (
              <p className="card-note">🎉 全都道府県を制覇しました！</p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">国</h2>
              <span className="card-count">
                {stats.countries.length} / {WORLD_COUNTRY_COUNT}
              </span>
            </div>
            <Progress value={percent(stats.countries.length, WORLD_COUNTRY_COUNT)} />
            {countries.length > 0 ? (
              <ul className="country-list">
                {countries.map((c) => (
                  <li key={c.code} className="country-chip">
                    <span aria-hidden>{flagEmoji(c.code)}</span>
                    {c.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card-note">場所を記録すると、訪れた国がここに並びます。</p>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">総移動距離</h2>
            <p className="distance-value">
              {formatKm(stats.distanceKm)}
              <small> km</small>
            </p>
            {stats.datedSpots >= 2 ? (
              <ul className="distance-facts">
                <li>🌍 地球 {(stats.distanceKm / EARTH_CIRCUMFERENCE_KM).toFixed(2)} 周分</li>
                <li>🌙 月までの {percent(stats.distanceKm, MOON_DISTANCE_KM).toFixed(1)}%</li>
              </ul>
            ) : (
              <p className="card-note">
                訪問日を入れた場所が2件以上になると計算されます（いま {stats.datedSpots} 件）。
              </p>
            )}
            <p className="card-note">
              訪問日のある {stats.datedSpots} 件を日付順につないだ、地球上の直線距離（大圏距離）の合計です。実際の経路より短めになります。
            </p>
          </section>

          <button type="button" className="card card-link" onClick={onShowRanking}>
            <span className="card-link-text">
              <strong>ランキングを見る</strong>
              <small>友だち・世界のなかで何位？</small>
            </span>
            <span className="card-link-arrow" aria-hidden>
              ›
            </span>
          </button>
        </>
      )}
    </>
  );
}
