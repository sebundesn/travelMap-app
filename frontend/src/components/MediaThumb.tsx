"use client";

import { assetUrl } from "@/lib/api";
import type { Media } from "@/lib/types";

/** A square-cropped still for a photo, or the first frame of a video. */
export default function MediaThumb({ media }: { media: Media }) {
  const src = assetUrl(media.url);
  if (!src) return null;
  if (media.kind === "video") {
    return <video src={`${src}#t=0.1`} preload="metadata" muted playsInline aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" />;
}
