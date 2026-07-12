"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { AdminInvite } from "./AdminView";

const STATUS_STYLES: Record<AdminInvite["status"], string> = {
  active: "bg-accent/15 text-accent",
  used: "bg-white/10 text-white",
  revoked: "bg-elem text-muted",
  expired: "bg-elem text-muted",
};

export function InvitesCard({
  invites,
  onChanged,
}: {
  invites: AdminInvite[] | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || undefined }),
      });
      if (!res.ok) {
        toast("couldn't create invite", "error");
        return;
      }
      const invite = (await res.json()) as AdminInvite;
      await copy(invite.url, "invite created — link copied");
      setNote("");
      onChanged();
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string, message = "link copied") {
    try {
      await navigator.clipboard.writeText(url);
      toast(message);
    } catch {
      toast(url); // clipboard blocked — surface the link itself
    }
  }

  async function revoke(id: number) {
    const res = await fetch(`/api/admin/invites/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast("couldn't revoke invite", "error");
      return;
    }
    toast("invite revoked");
    onChanged();
  }

  return (
    <section className="rounded-xl border border-elem p-5">
      <h2 className="text-sm tracking-widest text-muted uppercase">Invites</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (e.g. for alex)"
          className="min-w-0 flex-1 rounded-lg border border-elem bg-transparent px-3 py-2 text-sm outline-none focus:border-muted"
        />
        <button
          onClick={() => void create()}
          disabled={creating}
          className="cursor-pointer rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
        >
          {creating ? "creating…" : "new invite"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        single-use links, valid for 7 days
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {invites === null && (
          <li className="text-sm text-muted">loading invites…</li>
        )}
        {invites?.length === 0 && (
          <li className="text-sm text-muted">no invites yet</li>
        )}
        {invites?.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[invite.status]}`}
            >
              {invite.status}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {invite.note ?? <span className="text-muted">no note</span>}
              {invite.status === "used" && invite.usedByUsername && (
                <span className="text-muted"> — used by {invite.usedByUsername}</span>
              )}
            </span>
            {invite.status === "active" && (
              <>
                <button
                  onClick={() => void copy(invite.url)}
                  className="cursor-pointer text-xs text-muted transition hover:text-white"
                >
                  copy link
                </button>
                <button
                  onClick={() => void revoke(invite.id)}
                  className="cursor-pointer text-xs text-muted transition hover:text-accent"
                >
                  revoke
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
