"use client";

import { formatReset } from "@/lib/format";
import type { AdminOverview } from "./AdminView";

export function QuotaGauge({ overview }: { overview: AdminOverview | null }) {
  if (!overview) {
    return (
      <section className="rounded-xl border border-elem bg-side/60 p-5 backdrop-blur-md">
        <p className="text-sm text-muted">loading today&apos;s usage…</p>
      </section>
    );
  }

  const ratio =
    overview.globalLimit > 0 ? overview.globalUsed / overview.globalLimit : 1;
  const barColor =
    ratio >= 0.9 ? "bg-red-500" : ratio >= 0.7 ? "bg-yellow-500" : "bg-accent";

  return (
    <section className="rounded-xl border border-elem bg-side/60 p-5 backdrop-blur-md">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm tracking-widest text-muted uppercase">
          Global stream starts today
        </h2>
        <span className="text-sm text-muted">
          resets {formatReset(overview.resetsAt)}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold">
        {overview.globalUsed.toLocaleString()}
        <span className="text-lg font-normal text-muted">
          {" "}
          / {overview.globalLimit.toLocaleString()}
        </span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-elem">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </section>
  );
}
