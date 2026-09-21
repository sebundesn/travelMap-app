"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import Avatar from "./Avatar";

/**
 * A member's code card. Error correction stays at "H" so the avatar punched
 * into the middle never costs the code its readability.
 */
export default function QrCode({
  value,
  name,
  avatarUrl,
  size = 232,
}: {
  value: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#16151fff", light: "#ffffffff" },
    }).catch(() => {
      // an unrenderable code just leaves the card blank; the ID below still works
    });
  }, [value, size]);

  return (
    <div className="qr-card" style={{ width: size }}>
      <canvas ref={canvasRef} width={size} height={size} />
      <span className="qr-badge">
        <Avatar name={name} avatarUrl={avatarUrl} size={Math.round(size * 0.19)} />
      </span>
    </div>
  );
}
