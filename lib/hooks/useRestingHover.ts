"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Pass a hover up to the app only once the pointer rests.
 *
 * A viz reports the hovered word so the inspector can show it, and the
 * inspector re-renders its whole card for each one. Sweeping across a ring
 * passes dozens of ayahs a second; forwarding every one re-rendered that card
 * dozens of times for words nobody stopped on. The last value always lands,
 * `delay` ms after the pointer settles, and nothing fires after unmount.
 */
export function useRestingHover(emit: ((id: string | null) => void) | undefined, delay = 90) {
  const timer = useRef<number | undefined>(undefined);
  const emitRef = useRef(emit);
  useEffect(() => {
    emitRef.current = emit;
  }, [emit]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(
    (id: string | null) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => emitRef.current?.(id), delay);
    },
    [delay],
  );
}
