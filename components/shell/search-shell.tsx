"use client";

import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "./command-palette";
import { SearchTrigger } from "./search-trigger";

/**
 * Owns the palette's open state and the global hotkeys (⌘K, Ctrl+K, `/`).
 * Rendered from the (server) Topbar as the single client boundary.
 */
export function SearchShell() {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !open) {
        const t = e.target as HTMLElement | null;
        const editable =
          !!t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT" ||
            (t as HTMLElement).isContentEditable);
        if (editable) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <SearchTrigger onOpen={openPalette} />
      <CommandPalette open={open} onClose={closePalette} />
    </>
  );
}
