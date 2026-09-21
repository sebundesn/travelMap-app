"use client";

import { assetUrl } from "@/lib/api";

/** Everyone's picture, or the first letter of their name when they have none. */
export default function Avatar({
  name,
  avatarUrl,
  size = 36,
  className = "",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const src = assetUrl(avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={`avatar ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      ) : (
        initial
      )}
    </span>
  );
}
