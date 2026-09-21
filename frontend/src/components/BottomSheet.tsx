"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const DISMISS_PX = 110;

/**
 * Whoo-style sheet: slides up from the bottom and drags down to dismiss.
 * The caller keeps the children mounted until the exit animation finishes,
 * so `open` only drives the animation.
 */
export default function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function endDrag() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    if (dragY > DISMISS_PX) onClose();
    setDragY(0);
  }

  return (
    <div className={`sheet-layer ${open ? "sheet-layer-open" : "sheet-layer-closing"}`}>
      <div className="sheet-scrim" onClick={onClose} />
      <section
        className={`sheet${dragging ? " sheet-dragging" : ""}`}
        style={{ "--sheet-y": `${dragY}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="sheet-grip"
          onPointerDown={(e) => {
            dragStart.current = e.clientY;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragStart.current === null) return;
            setDragY(Math.max(0, e.clientY - dragStart.current));
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span />
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
