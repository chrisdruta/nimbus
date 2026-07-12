import { readSession } from "@/lib/session";
import Player from "@/components/Player";

export default async function Home() {
  const session = await readSession();

  return (
    <main style={{ padding: "2rem 1rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          maxWidth: 640,
          margin: "0 auto 1rem",
        }}
      >
        <h1 style={{ fontFamily: "var(--font-logo)", color: "var(--accent)" }}>
          nimbus
        </h1>
        {session && (
          <form action="/api/auth/logout" method="post">
            <button
              style={{
                background: "none",
                border: "1px solid var(--bg-elem)",
                color: "var(--text-secondary)",
                borderRadius: 4,
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
              }}
            >
              log out
            </button>
          </form>
        )}
      </header>

      {session ? (
        <Player />
      ) : (
        <div style={{ textAlign: "center", marginTop: "4rem" }}>
          <a
            href="/api/auth/login"
            style={{
              background: "var(--accent)",
              color: "#fff",
              borderRadius: 24,
              padding: "0.75rem 1.5rem",
              textDecoration: "none",
            }}
          >
            Sign in with SoundCloud
          </a>
        </div>
      )}
    </main>
  );
}
