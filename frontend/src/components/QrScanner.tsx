"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Pulls a handle out of either a raw scan ("@sebun") or a full add-friend link. */
export function handleFromScan(raw: string): string | null {
  const text = raw.trim();
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("add");
    if (fromQuery) return fromQuery.replace(/^@/, "").toLowerCase();
  } catch {
    // not a URL, fall through to the plain-handle reading
  }
  const bare = text.replace(/^travelmap:/i, "").replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(bare) ? bare : null;
}

const SCAN_INTERVAL_MS = 120;

/**
 * Live camera scanner. Frames are copied into an offscreen canvas and handed
 * to jsQR; the first readable code stops the loop and closes the sheet.
 */
export default function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (handle: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  const finish = useCallback(
    (handle: string) => {
      if (done.current) return;
      done.current = true;
      onScan(handle);
    },
    [onScan]
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("この端末ではカメラを使えません");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError("カメラを使う許可が必要です");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      timer = setInterval(() => {
        if (done.current || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        const canvas = (canvasRef.current ??= document.createElement("canvas"));
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx || !canvas.width) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: "dontInvert",
        });
        if (!code) return;
        const handle = handleFromScan(code.data);
        if (handle) finish(handle);
      }, SCAN_INTERVAL_MS);
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [finish]);

  return (
    <div className="scanner">
      <div className="scanner-frame">
        <video ref={videoRef} playsInline muted />
        <span className="scanner-reticle" />
      </div>
      <p className="scanner-hint">
        {error ?? "相手のQRコードを枠に合わせてください"}
      </p>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}
