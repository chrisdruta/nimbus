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
  from the SoundCloud CDN**, never through the app. AAC HLS plays through
  hls.js wherever MSE exists (native HLS pipelines don't feed Web Audio, which
  the visualizers and volume leveling depend on); native playback is the
  fallback for MSE-less browsers.
- **Your library**: likes and playlists, cursor-paginated with infinite
  scroll, artwork-tinted headers, the signature chip tiles — or a compact
  list view, with a toggle to hide unplayable tracks (both remembered).
- **A queue you own**: seeded Fisher–Yates shuffle, persisted
  order/position/history across reloads, repeat off/all/one,
  history-aware prev, auto-skip of unstreamable tracks.
- **Shuffle modes**: _classic_, _artist-spaced_ (no artist back-to-back),
  and _rediscovery_ (surfaces rarely/never-played tracks, powered by your
  per-track play history).
- **Track radio**: start an endless station from any track — related tracks
  queue up behind the seed and the station keeps growing, re-seeded from
  whatever played last. Optionally, any queue you built flows into radio
  when it ends ("continue with radio" on the queue panel, off by default).
- **Feed**: recent uploads and reposts from the people you follow, straight
  into the same tiles, queue, and radio affordances.
- **Search**: debounced full-catalog search for tracks and artists, with
  the query in the URL so results survive navigation. Results play through
  the same queue and quota path as everything else.
- **Artist pages**: every artist name links to an in-app profile — avatar,
  follower/track counts, follow/unfollow, and their full catalog with
  play/shuffle (each page links back to the artist on SoundCloud).
- **Slipstream**: a live "listening now" feed of what members are playing;
  join someone's slipstream to hear what they hear, position-synced and
  read-only. Your own queue parks untouched and every listener streams
  through their own account — leave and you're back exactly where you were.
  A "private listening" switch hides you from the feed whenever you want.
- **Shared sessions**: share your queue and it becomes everyone's — friends
  who join can queue tracks from their own library (credited by name),
  remove and reorder what's coming, and skip for the whole room. The host's
  player stays the clock; edits and skips propagate within seconds.
- **The stage**: six fullscreen modes — _art_, _spectrum_, _ridgeline_,
  _scope_, _piano_ (a keyboard lit key-per-semitone from the FFT, with a
  tempo-synced sequencer roll), _fourier_ (the spectrum rendered as a
  rotating stripe image, pushed through a second, spatial FFT — harmonic
  dot constellations sweeping to the beat) — switchable with ←/→ or 1–6,
  tinted from the track
  artwork, beat-reactive via onset detection, with per-scene presets and
  tuning, a true full-screen toggle, and whole-track waveform lookahead.
  All bars run through a TypeScript port of
  [cava](https://github.com/karlstav/cava)'s smoothing (MIT, attributed in
  `lib/viz/dsp.ts`) — buttery motion, not raw FFT jitter. A mini visualizer
  in the media bar doubles as the stage toggle.
- **Full media bar**: transport, scrubbing seek, like and follow-artist at
  a glance, perceptual (squared-taper) volume with optional auto-leveling —
  per-track loudness normalization measured client-side and cached — queue
  panel toggle, Media Session (media keys / lock screen).
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
[`docs/ROADMAP.md`](docs/ROADMAP.md). Up next: collection auto-continue
into radio, richer "recently played" views, casting to a TV, and a Tauri
client on this same backend.
