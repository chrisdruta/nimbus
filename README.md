# nimbus

An unofficial, lightweight SoundCloud client — aesthetic features for an
aesthetic listening experience.

Shuffle that actually works, a locally controlled queue, and reactive
visualizations. A Next.js revival of a 2020 Create React App (retired
from the tree; it survives in git history).

Powered by the official [SoundCloud API](https://developers.soundcloud.com/)
— nimbus is a free, personal, invite-only, non-commercial project. Tracks
always credit and link back to their creator and SoundCloud.

## Features

- **Sign in with SoundCloud** (OAuth 2.1 + PKCE). Tokens are versioned
  AES-256-GCM ciphertext bound to the user and token type, with rolling key
  rotation support. The backend brokers JSON only — audio streams **directly
  from the SoundCloud CDN**, never through the app. AAC HLS uses hls.js where
  the browser lacks native playback.
- **Your library**: likes and playlists, cursor-paginated with infinite
  scroll, artwork-tinted headers, the signature chip tiles.
- **A queue you own**: seeded Fisher–Yates shuffle, persisted
  order/position/history across reloads, repeat off/all/one,
  history-aware prev, auto-skip of unstreamable tracks.
- **Shuffle modes**: _classic_, _artist-spaced_ (no artist back-to-back),
  and _rediscovery_ (surfaces rarely/never-played tracks, powered by your
  per-track play history).
- **Slipstream**: a live "listening now" feed of what members are playing;
  join someone's slipstream to hear what they hear, position-synced and
  read-only. Your own queue parks untouched and every listener streams
  through their own account — leave and you're back exactly where you were.
- **Visualizations**: four fullscreen scenes — _spectrum_, _orbit_,
  _drift_, _scope_ — switchable with ←/→ or 1–4, tinted from the track
  artwork, beat-reactive via onset detection. All bars run through a
  TypeScript port of [cava](https://github.com/karlstav/cava)'s smoothing
  (MIT, attributed in `lib/viz/dsp.ts`) — buttery motion, not raw FFT
  jitter. A mini visualizer lives in the media bar.
- **Full media bar**: transport, scrubbing seek, persisted volume, queue
  panel, share, Media Session (media keys / lock screen).
- **Invite-only membership**: single-use invite links minted from the
  admin page. Per-user and global daily stream-start quotas keep the app
  inside SoundCloud's API limits; the owner manages users, invites, and
  limits at `/admin`.

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

## Development

```
bun run dev        # dev server on :3000
bun run build      # production build
bun run typecheck  # tsc --noEmit
bun test           # unit tests (tests/)
```

Architecture notes for contributors (and Claude) live in
[`CLAUDE.md`](CLAUDE.md).

## Roadmap

Feature tracking, milestone history, and validation records live in
[`docs/ROADMAP.md`](docs/ROADMAP.md). Up next: a visual redesign pass on
the scenes, feed/reposts/related-track continuation, richer "recently
played" views, and a Tauri client on this same backend.
