"use client";

import { assetUrl } from "@/lib/api";
import type { Media } from "@/lib/types";

/** Swipeable album of a place's photos and videos. */
export default function DetailMedia({ media, title }: { media: Media[]; title: string }) {
  if (media.length === 0) return null;
  return (
    <>
      <div className="detail-media">
        {media.map((m) => {
          const src = assetUrl(m.url);
          if (!src) return null;
          return (
            <div key={m.url} className="detail-media-item">
              {m.kind === "video" ? (
                <video src={src} controls playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={title} />
              )}
            </div>
          );
        })}
      </div>
      {media.length > 1 && <p className="detail-media-count">{media.length}件 ・ 横にスワイプ</p>}
    </>
  );
}
