# nimbus

A SoundCloud listening client focused on shuffle that actually works, a
locally controlled queue, and reactive visualizations. The 2020 Create
React App lives on in [`legacy/`](legacy/); this is its Next.js revival.

Powered by the official [SoundCloud API](https://developers.soundcloud.com/)
— nimbus is a free, personal, non-commercial project. Tracks always credit
and link back to their creator and SoundCloud.

## What it does (Milestone 3)

- Invite-only membership: the owner mints single-use invite links (valid
  7 days, revocable) from the admin page; a friend opens the link, signs
  in with SoundCloud, and is a member from then on — no allowlist edits,
  no env changes.
- Stream-start quotas: every play resolution counts against a per-user
  daily limit (default 150) and a global daily cap (default 12,000 —
  headroom under SoundCloud's 15,000/day per client id). Counters live
  in Postgres, reset at UTC midnight, and come back as friendly 429s the
  player surfaces as a toast (never a skip). The owner bypasses the
  per-user limit but not the global one.
- Admin page (`/admin`, owner only): global usage gauge, both limits
  editable live, invite management, and a user list with today's plays
  plus disable/remove — disabling cuts access on the very next request.

## What it does (Milestone 2)

- Sign in with SoundCloud (OAuth 2.1 + PKCE; tokens AES-256-GCM encrypted
  in Neon, single-use refresh rotation serialized under a row lock).
- Browse your entire likes collection and playlists — cursor-paginated
  with infinite scroll, artwork-tinted headers, the signature chip tiles.
- True seeded Fisher–Yates shuffle with a locally persisted queue
  (order/position/history survive reloads), repeat off/all/one,
  history-aware prev, and automatic skipping of unstreamable tracks.
- Full media bar: transport, scrubbing seek bar, persisted volume, queue
  panel, share, and Media Session (media-key/lock-screen) support.
- Live Web Audio visualizer (mini in the bar + fullscreen), fed by one
  persistent analyzed audio element streaming **directly from the
  SoundCloud CDN** — the backend only brokers JSON, never audio.
- Single-owner gate (`OWNER_SC_USER_ID`) — superseded by invites in M3;
  the env var now identifies the owner/admin account.

## Stack

Next.js 16 (App Router, TypeScript) · Bun · Tailwind CSS v4 · Neon
Postgres (`@neondatabase/serverless`) · `jose` sessions · no ORM.

```
Browser ── page + /api/* ──────────── Next.js (token broker; holds secrets)
   │                                     ├── Neon Postgres (encrypted tokens)
   │                                     └── SoundCloud API
   └── audio ──────────────────────── SoundCloud CDN (direct)
```

## Setup

Everything builds and tests without credentials. To run it for real:

1. **Register the app** (needs an Artist Pro subscription):
   <https://developers.soundcloud.com/docs/api/register-app>.
   Redirect URI for local dev: `http://localhost:3000/api/auth/callback`.
   If the console refuses plain-http localhost, use a `cloudflared` tunnel
   and set `APP_URL` to the tunnel origin instead.
2. **Create a Neon project** (free tier) and apply the schema:
   `psql "$DATABASE_URL" -f db/schema.sql`. The file is idempotent —
   re-apply it after pulling schema changes.
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

## Milestone 3 validation (2026-07-12)

- [x] `db/schema.sql` applies idempotently (twice) over live M2 data.
- [x] Invite lifecycle: create → landing page offers sign-in; revoke →
      page shows "no longer valid", second revoke 400s. Two concurrent
      claims of one code: exactly one wins, the invite records `used_by`.
- [x] Quotas: user at limit gets 429 `scope:"user"`; global at limit
      blocks everyone including the owner with `scope:"global"`; both
      carry `used`/`limit`/`resetsAt` and a `Retry-After` header. Owner
      bypasses only the per-user cap. Failed resolutions refund the
      counter. Successful plays increment the admin gauge.
- [x] Membership: disabled user's next API call 403s and the shell
      redirects to `/`; re-enabling restores access without re-login;
      a removed user 401s and needs a fresh invite. The owner account
      rejects disable/remove with 400. Non-owner `/api/admin/*` → 403.
- [ ] End-to-end invite sign-in with a second SoundCloud account
      (requires the production redirect URI — validate after deploy).

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

## What's next

Milestone 4: a real visualization system and richer shuffle modes
(artist spacing, rediscovery). Later: feed/reposts/related-track
continuation and a Tauri client on this same backend. SoundCloud stays
behind the `MusicProvider` seam (`lib/provider.ts`) so the UI never
depends on provider response shapes.
