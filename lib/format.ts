/** Quota reset time as a friendly local-time phrase, e.g. "at 02:00". */
export function formatReset(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "at midnight UTC";
  return `at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** 194000 -> "3:14"; hours kick in past 60m ("1:04:09"). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
