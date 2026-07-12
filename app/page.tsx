import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";

export default async function Landing() {
  const session = await readSession();
  if (session) redirect("/library");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-logo text-6xl text-accent">nimbus</h1>
        <p className="mt-3 text-muted">shuffle that actually works</p>
      </div>

      <a
        href="/api/auth/login"
        className="rounded-full bg-accent px-8 py-3 font-medium text-white transition hover:scale-105 hover:bg-[#ff5c1f]"
      >
        Continue with SoundCloud
      </a>

      <a
        href="https://soundcloud.com"
        target="_blank"
        rel="noreferrer"
        className="text-xs tracking-wide text-muted transition hover:text-white"
      >
        powered by SoundCloud
      </a>
    </main>
  );
}
