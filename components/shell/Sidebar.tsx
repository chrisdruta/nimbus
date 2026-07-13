"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarPlaylists } from "./SidebarPlaylists";
import { IconCloud } from "@/components/ui/icons";

interface Me {
  id: number;
  username: string;
  permalinkUrl: string;
  avatarUrl: string | null;
  isOwner: boolean;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Me | null) => {
        setMe(m);
      })
      .catch(() => {});
  }, []);

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-5">
      <div>
        <Link href="/library" className="font-logo text-3xl text-accent">
          nimbus
        </Link>
        <a
          href="https://soundcloud.com"
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex items-center gap-1.5 text-[11px] tracking-wide text-muted transition hover:text-white"
        >
          <IconCloud size={14} /> powered by SoundCloud
        </a>
      </div>

      {me && (
        <div className="flex items-center gap-3">
          {me.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatarUrl}
              alt=""
              className="h-11 w-11 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-elem text-muted">
              <IconCloud size={18} />
            </div>
          )}
          <div className="min-w-0">
            <a
              href={me.permalinkUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium hover:underline"
            >
              {me.username}
            </a>
            <form action="/api/auth/logout" method="post">
              <button className="cursor-pointer text-xs text-muted transition hover:text-accent">
                disconnect
              </button>
            </form>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs tracking-widest text-muted uppercase">
          Your library
        </p>
        <Link
          href="/library"
          onClick={onNavigate}
          className={`-mx-2 block rounded px-2 py-1.5 text-sm transition ${
            pathname === "/library"
              ? "border-l-2 border-accent bg-white/5 text-white"
              : "text-muted hover:text-white"
          }`}
        >
          Liked Tracks
        </Link>
        {me?.isOwner && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={`-mx-2 block rounded px-2 py-1.5 text-sm transition ${
              pathname === "/admin"
                ? "border-l-2 border-accent bg-white/5 text-white"
                : "text-muted hover:text-white"
            }`}
          >
            Admin
          </Link>
        )}
      </div>

      <SidebarPlaylists onNavigate={onNavigate} />
    </nav>
  );
}
