"use client";

import { ErrorView } from "@/components/StatusView";

export default function Error({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <ErrorView message="問題が発生しました" onRetry={unstable_retry} />;
}
