"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MediaBar } from "@/components/player/MediaBar";
import { FullscreenViz } from "@/components/viz/FullscreenViz";
import { IconMenu } from "@/components/ui/icons";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
      <div className="flex min-h-0">
        {/* Sidebar: static ≥md, drawer below */}
        <aside className="hidden w-60 shrink-0 bg-side md:block">
          <Sidebar />
        </aside>
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <aside className="w-60 bg-side shadow-2xl">
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </aside>
            <button
              aria-label="close menu"
              className="flex-1 bg-black/60"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        )}

        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <button
            aria-label="open menu"
            onClick={() => setDrawerOpen(true)}
            className="absolute top-4 left-4 z-10 rounded-md bg-black/50 p-2 text-muted hover:text-white md:hidden"
          >
            <IconMenu size={18} />
          </button>
          {children}
        </main>
      </div>

      <MediaBar />
      <FullscreenViz />
    </div>
  );
}
