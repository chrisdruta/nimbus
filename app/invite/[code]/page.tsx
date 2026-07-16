import Link from "next/link";
import { redirect } from "next/navigation";
import { getClaimableInvite } from "@/lib/server/invites";
import { readSession } from "@/lib/server/session";
import { headers } from "next/headers";
import { consumeRateLimit, RateLimitError, requestIp } from "@/lib/server/rate-limit";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await readSession();
  if (session) redirect("/library");

  const { code } = await params;
  let invite = null;
  try {
    consumeRateLimit(`invite:${requestIp(await headers())}`, 60, 10 * 60_000);
    if (/^[A-Za-z0-9_-]{22}$/.test(code)) {
      invite = await getClaimableInvite(code);
    }
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-logo text-6xl text-accent">nimbus</h1>
        <p className="mt-3 text-muted">
          {invite
            ? "you're invited — shuffle that actually works"
            : "this invite is no longer valid"}
        </p>
      </div>

      {invite ? (
        <a
          href={`/api/auth/login?invite=${encodeURIComponent(code)}`}
          className="rounded-full bg-accent px-8 py-3 font-medium text-white transition hover:scale-105 hover:bg-[#ff5c1f]"
        >
          Continue with SoundCloud
        </a>
      ) : (
        <Link
          href="/"
          className="text-sm text-muted transition hover:text-white"
        >
          ask for a fresh link, or head home
        </Link>
      )}

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
