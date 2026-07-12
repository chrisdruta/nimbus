# nimbus

A SoundCloud listening client focused on shuffle that actually works, a
locally controlled queue, and reactive visualizations. This branch is the
**Milestone 1 feasibility spike**: a minimal Next.js app that proves the
whole pipeline before anything bigger gets built. The 2020 Create React App
lives on in [`legacy/`](legacy/) for its visual identity.

Powered by the official [SoundCloud API](https://developers.soundcloud.com/)
— nimbus is a free, personal, non-commercial project. Tracks always credit
and link back to their creator and SoundCloud.

## What the spike proves

1. SoundCloud OAuth 2.1 + PKCE end-to-end (server-side code exchange).
2. Tokens encrypted at rest (AES-256-GCM) in Neon Postgres.
3. `/me` and the first page of liked tracks.
4. A liked track resolves to a stream the browser plays **directly from the
   SoundCloud CDN** (the backend only brokers JSON, never audio).
5. A Web Audio `AnalyserNode` sees real frequency data — or the on-page
   badge records exactly which CORS failure mode blocks it.
6. Track-to-track transition through the same audio element.
7. Single-use refresh-token rotation, serialized under a Postgres row lock.
8. A single-owner gate (`OWNER_SC_USER_ID`) until the invite system exists.

## Stack

Next.js 16 (App Router, TypeScript) · Bun · Neon Postgres
(`@neondatabase/serverless`) · `jose` sessions · no ORM, no CSS framework.

```
Browser ── page + /api/* ──────────── Next.js (token broker; holds secrets)
   │                                     ├── Neon Postgres (encrypted tokens)
   │                                     └── SoundCloud API
   └── audio ──────────────────────── SoundCloud CDN (direct)
```

## Setup — the credentials checkpoint

Everything builds and tests without credentials. To run the spike for real:

1. **Register the app** (needs an Artist Pro subscription):
   <https://developers.soundcloud.com/docs/api/register-app>.
   Redirect URI for local dev: `http://localhost:3000/api/auth/callback`.
   If the console refuses plain-http localhost, use a `cloudflared` tunnel
   and set `APP_URL` to the tunnel origin instead.
2. **Create a Neon project** (free tier) and apply the schema:
   `psql "$DATABASE_URL" -f db/schema.sql`.
3. **Configure env**: `cp .env.example .env.local` and fill it in
   (`TOKEN_ENCRYPTION_KEY` and `SESSION_SECRET` via `openssl rand -base64 32`).
   Leave `OWNER_SC_USER_ID` empty for your first login attempt — the
   callback rejects you with 403 and logs your numeric id; paste it in.
4. `bun install && bun run dev`, then open <http://localhost:3000>.

Credentials live only in `.env.local` (gitignored) — never commit them,
never put them in client code. Assume they may be revoked or rotated;
replacing them must never take more than editing env vars.

## Validation checklist

- [x] Sign in via SoundCloud; confirm in devtools that no client secret,
      code verifier, or token ever reaches the browser (only two cookies).
- [x] `users` row holds opaque `iv.ct.tag` blobs; `/api/me` still works
      after a server restart.
- [x] Likes render; clicking a track plays audio fetched straight from
      `*.sndcdn.com` (check the Network tab — never the app origin).
- [x] Visualizer badge: record `CORS OK` or the exact failure mode, plus
      the stream protocol (progressive vs HLS). **If CORS fails, that is a
      valid spike result — write it down here and stop; no proxy hacks.**
- [x] Let a track end: the next one auto-plays; bars keep moving.
- [x] `curl -X POST localhost:3000/api/debug/refresh -b <session cookie>`
      twice sequentially (rotation persists), then twice concurrently
      (row lock serializes); `/api/likes` still works afterwards.
- [x] A second SoundCloud account gets 403 and no `users` row.

## Spike results (2026-07-12)

- **CORS verdict: OK** — `AnalyserNode` sees real frequency data. One
  wrinkle: the `/tracks/:id/streams` variant URLs live on
  `api.soundcloud.com` and demand the OAuth header (a bare `<audio>`
  element gets 401, which masquerades as a CORS load failure). The backend
  now follows the authorized 302 server-side and returns the final signed
  `cf-media.sndcdn.com` URL — that host serves `Access-Control-Allow-Origin: *`,
  `audio/mpeg`, and honors Range requests, so `crossorigin="anonymous"` +
  `MediaElementSource` works. Audio still flows browser → CDN directly.
- **Stream protocol**: progressive MP3 (`http_mp3_128_url`) available on
  tested tracks; HLS variants also offered (`hls_mp3_128_url`,
  `hls_aac_160_url`). Signed CDN URLs use CloudFront query auth
  (`Policy`/`Signature`/`Key-Pair-Id`) — resolve fresh per play.
- **Auth header form**: `Authorization: OAuth <token>` works against
  `api.soundcloud.com` (Bearer fallback never needed).
- **Refresh rotation**: forced sequential rotations persist correctly;
  two concurrent forced refreshes serialize under the row lock and both
  succeed; API calls keep working afterward. Tokens at rest are opaque
  AES-256-GCM blobs.
- **Owner gate**: unapproved sign-in gets 403, no row created, and the
  numeric id is logged (used to bootstrap `OWNER_SC_USER_ID`).

## Development

```
bun run dev        # dev server on :3000
bun run build      # production build
bun run typecheck  # tsc --noEmit
bun test           # unit tests (tests/)
```

## What's next (not in this spike)

Full likes pagination, Fisher–Yates shuffle + persistent queue, the legacy
visual identity port, invite/allowlist/quota system, Vercel deployment, a
real visualization system, and eventually a Tauri client on this same
backend. SoundCloud stays behind the `MusicProvider` seam
(`lib/provider.ts`) so the UI never depends on provider response shapes.
