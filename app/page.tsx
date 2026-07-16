import { redirect } from "next/navigation";
import { readSession } from "@/lib/server/session";
import { getUserAuth } from "@/lib/server/db";
import { FarewellSweeper } from "@/components/auth/FarewellSweeper";

const AUTH_ERRORS: Record<string, string> = {
  not_invited: "nimbus is invite-only — ask Chris for an invite link",
  invite_invalid: "that invite is no longer valid — ask for a fresh link",
  disabled: "this account has been disabled",
};

const BYE_MESSAGES: Record<string, string> = {
  disabled: "this account has been disabled",
  removed: "this account is no longer a member",
};

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; bye?: string }>;
}) {
  const session = await readSession();
  if (session) {
    const membership = await getUserAuth(session.userId);
    if (
      membership &&
      !membership.disabled &&
      membership.scUserId === session.scUserId
    ) {
      redirect("/library");
    }
    // Cookie present but membership invalid: route through the farewell so
    // the cookie expires and local data clears. The farewell deletes the
    // cookie before landing back here, so this can't loop.
    redirect("/api/auth/cleanup");
  }
  const { auth_error, bye } = await searchParams;
  const errorMessage =
    (auth_error ? AUTH_ERRORS[auth_error] : undefined) ??
    (bye ? BYE_MESSAGES[bye] : undefined);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-logo text-6xl text-accent">nimbus</h1>
        <p className="mt-3 text-muted">shuffle that actually works</p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-elem px-4 py-2 text-sm text-muted">
          {errorMessage}
        </p>
      )}
      {bye && <FarewellSweeper />}

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
