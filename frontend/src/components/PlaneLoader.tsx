"use client";

import { useEffect, useId, useRef } from "react";

const CYCLE_MS = 3200;
const PLANE_SCALE = 0.8; // plane art is drawn on a 120x50 box, shown at 96x40
const PIVOT_X = 48;
const PIVOT_Y = 20;
const IDLE_T = 0.42;

type Props = {
  /** "loading" flies the plane along the route; "error" parks it mid-route. */
  state?: "loading" | "error";
  size?: "md" | "sm";
};

/**
 * The shared plane animation used for loading and error screens.
 * Loading: a plane loops along a dashed flight path. Error: the plane stops
 * mid-route and the destination turns into a red cross.
 */
export default function PlaneLoader({ state = "loading", size = "md" }: Props) {
  const uid = useId();
  const pathId = `flight-${uid}`;
  const pathRef = useRef<SVGPathElement>(null);
  const planeRef = useRef<SVGGElement>(null);
  const failed = state === "error";

  useEffect(() => {
    const path = pathRef.current;
    const plane = planeRef.current;
    if (!path || !plane) return;

    const len = path.getTotalLength();
    const place = (t: number) => {
      const pt = path.getPointAtLength(t * len);
      const ahead = path.getPointAtLength(Math.min(t * len + 1, len));
      const angle = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
      plane.setAttribute(
        "transform",
        `translate(${pt.x - PIVOT_X} ${pt.y - PIVOT_Y}) rotate(${angle} ${PIVOT_X} ${PIVOT_Y})`,
      );
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (failed || reduced) {
      place(IDLE_T);
      return;
    }

    let raf = 0;
    let start: number | null = null;
    const frame = (ts: number) => {
      if (start === null) start = ts;
      place(((ts - start) % CYCLE_MS) / CYCLE_MS);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [failed]);

  return (
    <div className={`plane-loader plane-loader-${size}${failed ? " plane-loader-error" : ""}`}>
      <svg viewBox="0 0 420 110" className="plane-track" aria-hidden="true">
        <path
          id={pathId}
          ref={pathRef}
          className="plane-route"
          d="M 20 85 Q 140 25 210 60 T 400 35"
        />
        <circle className="plane-stop" cx="20" cy="85" r="4" />
        {failed ? (
          <path className="plane-cross" d="M394 29 L406 41 M406 29 L394 41" />
        ) : (
          <circle className="plane-stop" cx="400" cy="35" r="4" />
        )}
        <g ref={planeRef}>
          <g transform={`scale(${PLANE_SCALE})`}>
            <path d="M58 21 L44 9 L49 9 L68 21 Z" fill="#5F5E5A" />
            <path d="M20 22 L12 17 L16 17 L26 22 Z" fill="#5F5E5A" />
            <path
              d="M8 21 C8 20 9 19 11 19 L96 18 C106 18 113 21 117 25 C113 29 106 31 96 31 L34 31 C24 31 14 27 8 22 Z"
              fill="#F1EFE8"
              stroke="#888780"
              strokeWidth="0.6"
            />
            <path
              d="M14 26 C20 29 27 31 34 31 L96 31 C106 31 113 29 117 25 L116 26 C112 28.5 104 30 96 30 L34 30 C27 30 20 28.5 14 26 Z"
              fill="#B4B2A9"
            />
            <path
              d="M12 23.5 C18 26 26 27.5 34 27.5 L100 27.5 C106 27.5 110 27 113 26.5"
              fill="none"
              stroke={failed ? "#E2445C" : "#378ADD"}
              strokeWidth="1.6"
            />
            <path d="M10 20 L4 3 L13 3 L32 19 Z" fill={failed ? "#B3243B" : "#185FA5"} />
            <path d="M7 11 L12 11 L22 19 L17 19 Z" fill={failed ? "#E2445C" : "#378ADD"} />
            <line
              x1="34"
              y1="22"
              x2="94"
              y2="22"
              stroke="#0C447C"
              strokeWidth="2"
              strokeDasharray="1.6 2.4"
            />
            <path d="M104 21 L110 21.5 L113 23.5 L106 23.5 Z" fill="#0C447C" />
            <rect
              x="98"
              y="20"
              width="2.4"
              height="7"
              rx="0.6"
              fill="none"
              stroke="#888780"
              strokeWidth="0.5"
            />
            <path d="M16 25 L6 33 L11 33 L26 26 Z" fill="#D3D1C7" stroke="#888780" strokeWidth="0.5" />
            <path d="M58 27 L42 43 L49 43 L72 28 Z" fill="#D3D1C7" stroke="#888780" strokeWidth="0.6" />
            <path d="M42 43 L49 43 L50 41.5 L44 41.5 Z" fill={failed ? "#E2445C" : "#378ADD"} />
            <rect x="54" y="30" width="16" height="6" rx="3" fill="#B4B2A9" stroke="#5F5E5A" strokeWidth="0.5" />
            <ellipse cx="69.5" cy="33" rx="1.4" ry="3" fill="#444441" />
            <rect x="55" y="30.8" width="12" height="1.4" rx="0.7" fill="#F1EFE8" />
          </g>
        </g>
      </svg>
    </div>
  );
}
