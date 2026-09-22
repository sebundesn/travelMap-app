"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EXIT_MS = 300;

/** Mount/open state for a BottomSheet that stays mounted while it slides away. */
export function useSheet() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = useCallback(() => {
    clear();
    setMounted(true);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    clear();
    setOpen(false);
    timer.current = setTimeout(() => setMounted(false), EXIT_MS);
  }, []);

  useEffect(() => clear, []);

  return { mounted, open, show, hide };
}
