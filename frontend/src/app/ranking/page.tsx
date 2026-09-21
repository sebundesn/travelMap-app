"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { RankEntry, RankMetric, RankScope, Rankings } from "@/lib/types";
import { Loading, ErrorView } from "@/components/StatusView";

const SCOPES: { id: RankScope; label: string }[] = [
  { id: "friends", label: "友だち" },
  { id: "world", label: "世界" },
];

const METRICS: { id: RankMetric; label: string }[] = [
  { id: "countries", label: "訪問国" },
  { id: "prefectures", label: "都道府県" },
  { id: "distance", label: "移動距離" },
  { id: "spots", label: "スポット" },
];

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatValue(entry: RankEntry, metric: RankMetric) {
  switch (metric) {
    case "countries":
      return `${entry.countries}か国`;
    case "prefectures":
      return `${entry.prefectures}/47`;
    case "distance":
      return `${Math.round(entry.distanceKm).toLocaleString("ja-JP")} km`;
    case "spots":
      return `${entry.spots}件`;
  }
}

function Row({ entry, metric }: { entry: RankEntry; metric: RankMetric }) {
  return (
    <li className={`rank-row${entry.isMe ? " rank-row-me" : ""}`}>
      <span className="rank-pos">{MEDALS[entry.rank] ?? entry.rank}</span>
      <Avatar name={entry.user.name} avatarUrl={entry.user.avatarUrl} size={40} />
      <span className="person-text">
        <strong>{entry.isMe ? `${entry.user.name}（あなた）` : entry.user.name}</strong>
        <small>@{entry.user.handle}</small>
      </span>
      <span className="rank-value">{formatValue(entry, metric)}</span>
    </li>
  );
}

export default function RankingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [scope, setScope] = useState<RankScope>("friends");
  const [metric, setMetric] = useState<RankMetric>("countries");
  // Keyed by what was asked for, so a slow reply for an old tab never overwrites a newer one.
  const [result, setResult] = useState<{ key: string; data: Rankings | null } | null>(null);

  const key = `${scope}:${metric}`;

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .rankings(scope, metric)
      .then((data) => active && setResult({ key, data }))
      .catch(() => active && setResult({ key, data: null }));
    return () => {
      active = false;
    };
  }, [user?.id, scope, metric, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) {
    return <Loading />;
  }

  const ready = result?.key === key;
  const data = ready ? result.data : null;
  const meListed = data?.entries.some((e) => e.isMe) ?? false;
  const optedOut = scope === "world" && data?.me != null && data.me.rank === 0;

  return (
    <div className="page">
      <header className="page-head">
        <Link href="/stats" className="round-btn" aria-label="戻る">
          ←
        </Link>
        <h1>ランキング</h1>
        <span className="round-btn round-btn-spacer" aria-hidden />
      </header>

      <div className="page-body">
        <div className="segmented" role="tablist" aria-label="範囲">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              className={scope === s.id ? "segment segment-on" : "segment"}
              onClick={() => setScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="chip-row" role="tablist" aria-label="指標">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              className={metric === m.id ? "chip chip-on" : "chip"}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <section className="card">
          {!ready && <Loading inline />}
          {ready && !data && <ErrorView inline message="ランキングを読み込めませんでした" />}

          {data && (
            <>
              {scope === "friends" && data.entries.length === 1 && (
                <p className="card-note">
                  友だちを追加すると、ここで旅の成績を比べられます。
                </p>
              )}
              {optedOut && (
                <p className="card-note">
                  世界ランキングには表示されていません。プロフィールの設定から参加できます。
                </p>
              )}
              <ol className="rank-list">
                {data.entries.map((e) => (
                  <Row key={e.user.id} entry={e} metric={metric} />
                ))}
              </ol>
              {data.me && data.me.rank > 0 && !meListed && (
                <>
                  <p className="rank-gap" aria-hidden>
                    ⋮
                  </p>
                  <ol className="rank-list">
                    <Row entry={data.me} metric={metric} />
                  </ol>
                </>
              )}
              {scope === "world" && (
                <p className="card-note">参加者 {data.total.toLocaleString("ja-JP")}人</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
