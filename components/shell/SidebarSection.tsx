"use client";

import { useEffect, useState, type ReactNode } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { IconChevronUp } from "@/components/ui/icons";

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/** Collapsible sidebar section; collapsed state persists per section id. */
export function SidebarSection({
  id,
  title,
  className = "shrink-0",
  children,
}: {
  id: string;
  title: string;
  /** Wrapper classes. Default keeps the section its natural height; a
   * section that owns its own scroll passes flex sizing instead. */
  className?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Pref is read post-mount so SSR and first paint agree.
  useEffect(() => {
    setCollapsed(readPref(`sidebar:${id}:collapsed`, isBoolean) ?? false);
  }, [id]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writePref(`sidebar:${id}:collapsed`, next);
  };

  return (
    <div className={className}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="group mb-2 flex w-full shrink-0 cursor-pointer items-center justify-between text-xs tracking-widest text-muted uppercase transition hover:text-white"
      >
        {title}
        <IconChevronUp
          size={11}
          className={`opacity-0 transition group-hover:opacity-100 ${
            collapsed ? "rotate-180" : ""
          }`}
        />
      </button>
      {!collapsed && children}
    </div>
  );
}
