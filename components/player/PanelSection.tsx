"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconChevronUp } from "@/components/ui/icons";
import { readPref, writePref } from "@/lib/prefs";

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Collapsible queue-panel section: lowercase label (with optional count),
 * hover-revealed chevron, collapse state persisted per section. `control`
 * renders on the header's right side, outside the toggle button, so
 * clicking a switch never collapses the section.
 */
export function PanelSection({
  id,
  title,
  count,
  control,
  defaultCollapsed = false,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  control?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Pref is read post-mount so SSR and first paint agree.
  useEffect(() => {
    setCollapsed(readPref(`panel:${id}:collapsed`, isBoolean) ?? defaultCollapsed);
  }, [id, defaultCollapsed]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writePref(`panel:${id}:collapsed`, next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-2 py-1 pt-3">
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          className="group flex min-w-0 cursor-pointer items-center gap-1.5 text-xs text-muted transition hover:text-white"
        >
          <span className="truncate">
            {count === undefined ? title : `${title} · ${count}`}
          </span>
          <IconChevronUp
            size={11}
            className={`shrink-0 opacity-0 transition group-hover:opacity-100 ${
              collapsed ? "rotate-180" : ""
            }`}
          />
        </button>
        {control}
      </div>
      {!collapsed && children}
    </div>
  );
}
