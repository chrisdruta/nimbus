"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { AdminOverview } from "./AdminView";

export function SettingsCard({
  overview,
  onSaved,
}: {
  overview: AdminOverview | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [userLimit, setUserLimit] = useState("");
  const [globalLimit, setGlobalLimit] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!overview) return;
    setUserLimit(String(overview.userLimit));
    setGlobalLimit(String(overview.globalLimit));
  }, [overview]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userDailyPlayLimit: Number(userLimit),
          globalDailyPlayLimit: Number(globalLimit),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast(body?.error ?? "couldn't save limits", "error");
        return;
      }
      toast("limits saved");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-elem p-5">
      <h2 className="text-sm tracking-widest text-muted uppercase">
        Daily limits
      </h2>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">per user</span>
          <input
            type="number"
            min={0}
            value={userLimit}
            onChange={(e) => setUserLimit(e.target.value)}
            className="w-32 rounded-lg border border-elem bg-transparent px-3 py-2 outline-none focus:border-muted"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">global (max 15,000)</span>
          <input
            type="number"
            min={0}
            max={15000}
            value={globalLimit}
            onChange={(e) => setGlobalLimit(e.target.value)}
            className="w-32 rounded-lg border border-elem bg-transparent px-3 py-2 outline-none focus:border-muted"
          />
        </label>
        <button
          onClick={() => void save()}
          disabled={saving || !overview}
          className="cursor-pointer rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
        >
          {saving ? "saving…" : "save"}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">
        the owner is exempt from the per-user limit but still counts toward the
        global one
      </p>
    </section>
  );
}
