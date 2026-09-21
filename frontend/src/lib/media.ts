import type { Media } from "./types";

export const MAX_VIDEO_SECONDS = 15;

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(file.name);
}

/**
 * Length of a picked video in seconds, or null when the browser cannot decode it.
 * The server checks again, so an unreadable file is left for it to judge.
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** What represents a place at a glance: its first photo, else its first video. */
export function coverOf(media: Media[]): Media | null {
  return media.find((m) => m.kind === "image") ?? media[0] ?? null;
}
