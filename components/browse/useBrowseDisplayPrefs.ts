"use client";

import { useCallback, useEffect, useState } from "react";
import { readPref, writePref } from "@/lib/prefs";

export type BrowseLayout = "grid" | "list";

const isLayout = (v: unknown): v is BrowseLayout => v === "grid" || v === "list";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Display preferences for library collection views, shared across likes and
 * playlists. Saved prefs apply after mount so the server and first client
 * render agree (no hydration mismatch).
 */
export function useBrowseDisplayPrefs() {
  const [layout, setLayoutState] = useState<BrowseLayout>("grid");
  const [hideUnplayable, setHideUnplayableState] = useState(false);

  useEffect(() => {
    const savedLayout = readPref("browseLayout", isLayout);
    if (savedLayout !== null) setLayoutState(savedLayout);
    const savedHide = readPref("hideUnplayable", isBool);
    if (savedHide !== null) setHideUnplayableState(savedHide);
  }, []);

  const setLayout = useCallback((l: BrowseLayout) => {
    setLayoutState(l);
    writePref("browseLayout", l);
  }, []);

  const setHideUnplayable = useCallback((v: boolean) => {
    setHideUnplayableState(v);
    writePref("hideUnplayable", v);
  }, []);

  return { layout, setLayout, hideUnplayable, setHideUnplayable };
}
