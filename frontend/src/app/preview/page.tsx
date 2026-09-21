"use client";

import { ErrorView, Loading } from "@/components/StatusView";

export default function PreviewPage() {
  return (
    <div style={{ display: "grid", gap: "2rem", padding: "2rem 1.25rem" }}>
      <Loading inline />
      <ErrorView inline message="ランキングを読み込めませんでした" onRetry={() => {}} />
      <Loading />
      <ErrorView message="問題が発生しました" onRetry={() => {}} />
    </div>
  );
}
