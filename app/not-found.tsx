import { connection } from "next/server";
import Link from "next/link";

// Rendered per-request (not prerendered) so the page's scripts carry the
// CSP nonce from proxy.ts — a static 404 would ship nonce-less script tags
// the browser blocks.
export default async function NotFound() {
  await connection();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-logo text-6xl text-accent">nimbus</h1>
        <p className="mt-3 text-muted">nothing plays here — page not found</p>
      </div>
      <Link
        href="/"
        className="text-xs tracking-wide text-muted transition hover:text-white"
      >
        back to the music
      </Link>
    </main>
  );
}
