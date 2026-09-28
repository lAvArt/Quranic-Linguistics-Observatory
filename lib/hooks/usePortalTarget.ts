"use client";

import { useEffect, useState } from "react";

/**
 * The element with this id, tracked across mounts.
 *
 * A viz renders its cards into shell slots (`#viz-sidebar-portal`,
 * `#viz-context-portal`), but the shell doesn't keep every slot mounted: on a
 * phone the sidebar slot exists only while the legend sheet is open. Reading
 * `document.getElementById` during render finds nothing then — the sheet's DOM
 * isn't committed yet — and a viz with no other reason to re-render never looks
 * again, leaving the sheet empty. This re-resolves after every DOM change and
 * re-renders only when the element itself changes.
 */
export function usePortalTarget(id: string): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setEl(document.getElementById(id));
    find();
    const mo = new MutationObserver(find);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [id]);
  return el;
}
