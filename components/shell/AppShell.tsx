"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { MediaBar } from "@/components/player/MediaBar";
import { SidePanel } from "@/components/player/SidePanel";
import { useSlipstreamFeed } from "@/components/slipstream/useSlipstreamFeed";
import { StageView } from "@/components/viz/StageView";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";
import { IconMenu } from "@/components/ui/icons";
import { readPref, writePref } from "@/lib/prefs";

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Queue column: open by default; the saved pref applies after mount so
  // the server and first client render agree (no hydration mismatch).
  const [panelOpen, setPanelOpen] = useState(true);
  const { stageOpen } = usePlayerState();
  const actions = usePlayerActions();
  const { rows: feed, you } = useSlipstreamFeed();
  const anyoneLive = feed.some((r) => r.hostId !== you);

  // Sidebar navigation must always reveal the page it loads. Route
  // changes close the stage (StageView watches the pathname), but a
  // link to the page you're already on doesn't change the route — so
  // any link click in the nav closes it too.
  const closeStageOnNav = (e: React.MouseEvent) => {
    if (stageOpen && (e.target as HTMLElement).closest("a")) {
      actions.closeStage();
    }
  };

  useEffect(() => {
    const saved = readPref("queuePanel", isBool);
    if (saved !== null) setPanelOpen(saved);
  }, []);

  const setPanel = (open: boolean) => {
    setPanelOpen(open);
    writePref("queuePanel", open);
  };

  return (
    <div className="relative isolate grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
      <AmbientBackdrop />
      <div className="relative flex min-h-0">
        {/* Anchored at the row level (not inside the scrolling main) so
            they stay put while the library scrolls. */}
        <button
          aria-label="open menu"
          onClick={() => setDrawerOpen(true)}
          className="absolute top-4 left-4 z-30 rounded-md bg-black/50 p-2 text-muted hover:text-white md:hidden"
        >
          <IconMenu size={18} />
        </button>
        {/* Sidebar: static ≥md, drawer below */}
        <aside
          className="glass hidden w-60 shrink-0 md:block xl:w-72"
          onClickCapture={closeStageOnNav}
        >
          <Sidebar />
        </aside>
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <aside
              className="w-60 bg-side shadow-2xl"
              onClickCapture={closeStageOnNav}
            >
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </aside>
            <button
              aria-label="close menu"
              className="flex-1 bg-black/60"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        )}

        {/* Inner div owns scrolling so the page keeps its scroll position
            while the stage overlays the content area (shell stays put). */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">{children}</div>
          {stageOpen && <StageView />}
        </main>

        {/* Queue/slipstream column: persistent on desktop, collapsible */}
        {panelOpen && (
          <aside className="glass hidden w-80 shrink-0 border-l border-white/5 md:block xl:w-96">
            <SidePanel onClose={() => setPanel(false)} feed={feed} you={you} />
          </aside>
        )}
      </div>

      <MediaBar
        queueOpen={panelOpen}
        onToggleQueue={() => setPanel(!panelOpen)}
        queueLive={anyoneLive}
      />
    </div>
  );
}
