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

- [ ] Sign in via SoundCloud; confirm in devtools that no client secret,
      code verifier, or token ever reaches the browser (only two cookies).
- [ ] `users` row holds opaque `iv.ct.tag` blobs; `/api/me` still works
      after a server restart.
- [ ] Likes render; clicking a track plays audio fetched straight from
      `*.sndcdn.com` (check the Network tab — never the app origin).
- [ ] Visualizer badge: record `CORS OK` or the exact failure mode, plus
      the stream protocol (progressive vs HLS). **If CORS fails, that is a
      valid spike result — write it down here and stop; no proxy hacks.**
- [ ] Let a track end: the next one auto-plays; bars keep moving.
- [ ] `curl -X POST localhost:3000/api/debug/refresh -b <session cookie>`
      twice sequentially (rotation persists), then twice concurrently
      (row lock serializes); `/api/likes` still works afterwards.
- [ ] A second SoundCloud account gets 403 and no `users` row.

## Spike results

_To be filled in after the validation run:_

- CORS verdict: _pending_
- Stream protocol seen: _pending_
- Auth header form (`OAuth` vs `Bearer`): _pending_
- Notes on refresh rotation: _pending_

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
