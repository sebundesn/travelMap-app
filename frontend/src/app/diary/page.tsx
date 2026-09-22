"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AlbumPanel from "@/components/AlbumPanel";
import RankingPanel from "@/components/RankingPanel";
import StatsPanel from "@/components/StatsPanel";
import { Loading } from "@/components/StatusView";
import { useAuth } from "@/context/AuthContext";

type Tab = "records" | "album" | "ranking";

const TABS: { id: Tab; label: string }[] = [
  { id: "records", label: "旅の記録" },
  { id: "album", label: "アルバム" },
  { id: "ranking", label: "ランキング" },
];

function DiaryScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = params.get("tab");
    return TABS.some((t) => t.id === requested) ? (requested as Tab) : "records";
  });

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <Loading />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <Link href="/" className="round-btn" aria-label="地図に戻る">
          ←
        </Link>
        <h1>旅日記</h1>
        <span className="round-btn round-btn-spacer" aria-hidden />
      </header>

      <div className="page-body">
        <div className="segmented" role="tablist" aria-label="旅日記">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "segment segment-on" : "segment"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "records" && <StatsPanel onShowRanking={() => setTab("ranking")} />}
        {tab === "album" && <AlbumPanel />}
        {tab === "ranking" && <RankingPanel />}
      </div>
    </div>
  );
}

export default function DiaryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DiaryScreen />
    </Suspense>
  );
}
