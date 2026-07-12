# Roadmap & milestone log

The living tracker for nimbus. Add ideas under **Next / ideas**; when a
milestone ships, move it to **Shipped** with its date and validation
record. The README stays a clean front page — history lives here.

## Next / ideas

- **Visualization redesign pass** — the M4 scenes work but Chris has
  redesign ideas; the `Scene` interface (`lib/viz/scene.ts`) makes visual
  rework independent of the DSP/analysis layer.
- **Feed / reposts / related-track continuation** — keep playback going
  past the end of a collection.
- **Recently played** — views on top of `track_plays`
  (`ORDER BY last_played_at DESC` is already indexed).
- **Tauri client** — native shell on this same backend.

## Shipped

### Milestone 4 — visualization system + shuffle modes (2026-07-12)

Four canvas-2D fullscreen scenes (spectrum / orbit / drift / scope) on a
plug-in `Scene` interface; cava's smoothing ported to tested TypeScript
(monstercat filter, gravity, sensitivity autoscale); bass-band onset
detection; artwork-derived palette theming; scene picker (←/→, 1–4,
pills) with persisted choice. Shuffle mode menu: classic, artist-spaced
(greedy repair pass), rediscovery (exponential-race weighted shuffle fed
by per-track `track_plays` tallies recorded server-side after successful
stream resolution).

Validation:
- 116 unit tests green (DSP, onset, scope, particles, palette, prefs,
  shuffle algorithms, queue-state evolution); typecheck + build clean.
- `db/schema.sql` applied idempotently (twice) over live data.
- Live: `/api/plays` 401s anonymously; two plays of one track →
  `playCount: 2`; a failed (422) resolution creates no tally and refunds
  the quota counter.
- Persisted queues from before the change load as `classic` without
  wiping state.

### Milestone 3 — invites, quotas, admin (2026-07-12)

Single-use invite links (7-day expiry, revocable; code rides the signed
OAuth dance cookie) replace the single-owner gate; `OWNER_SC_USER_ID`
now identifies the owner/admin. Per-user (default 150/day) and global
(default 12,000/day — headroom under SoundCloud's 15,000 client cap)
stream-start quotas, enforced atomically before stream resolution with
refund-on-failure and friendly 429s. DB-backed membership checks cut off
disabled/removed users on their next request despite 7-day session JWTs.
Owner-only `/admin`: usage gauge, live-editable limits, invite and user
management.

Validation:
- Schema applies idempotently over live M2 data.
- Invite lifecycle: create → landing offers sign-in; revoke → "no longer
  valid", second revoke 400s; two concurrent claims of one code → exactly
  one winner, `used_by` recorded.
- Quotas: user-cap 429 (`scope:"user"`), global-cap 429 blocks everyone
  including the owner (`scope:"global"`), both with `used`/`limit`/
  `resetsAt` + `Retry-After`; owner bypasses only the per-user cap;
  failed resolutions refund; the player toasts and pauses on 429 (never
  skip-spams).
- Membership: disable → next call 403s and the shell bounces; re-enable
  restores without re-login; remove → 401 + fresh invite needed; owner
  can't be disabled/removed; non-owner `/api/admin/*` → 403.
- End-to-end in production: an invited member signed in via link and
  streamed.

### Milestone 2 — full player + redesign (2026-07-12, deployed)

Tailwind v4 "evolved classic" of the 2020 design (dark sidebar, tinted
header band, chip tiles, 88px media bar); cursor-paginated likes +
playlists with infinite scroll; seeded Fisher–Yates queue engine
persisted to localStorage; PlayerProvider with one persistent analyzed
audio element; Media Session support. Deployed on Vercel
(nimbus-jade.vercel.app), production redirect URI registered — the
SoundCloud console holds exactly one URI, so local dev reuses the
owner's stored tokens plus a minted session.

Validation:
- No client secret, code verifier, or token ever reaches the browser
  (two cookies only).
- `users` rows hold opaque `iv.ct.tag` blobs; sessions survive server
  restarts.
- Audio fetches straight from `*.sndcdn.com` — never the app origin.
- Track end auto-advances; bars keep moving.
- Token rotation: sequential rotations persist; concurrent rotations
  serialize under the row lock; API keeps working after.
- A second SoundCloud account gets 403 and no `users` row.

### Milestone 1 — feasibility spike (2026-07-12)

All 8 spike goals passed. Key findings, still load-bearing:

- **CORS verdict: OK** — `AnalyserNode` sees real frequency data. The
  `/tracks/:id/streams` variant URLs live on `api.soundcloud.com` and
  demand the OAuth header (a bare `<audio>` element gets 401, which
  masquerades as a CORS failure). The backend follows the authorized 302
  server-side and returns the final signed `cf-media.sndcdn.com` URL —
  that host serves `Access-Control-Allow-Origin: *`, `audio/mpeg`, and
  honors Range requests, so `crossorigin="anonymous"` +
  `MediaElementSource` works. Audio flows browser → CDN directly.
- **Stream protocol**: progressive MP3 (`http_mp3_128_url`) on tested
  tracks; HLS variants also offered. Signed CDN URLs use CloudFront query
  auth — resolve fresh per play.
- **Auth header form**: `Authorization: OAuth <token>` against
  `api.soundcloud.com` (Bearer never needed).
- **Owner gate bootstrap**: unapproved sign-in gets 403, no row created,
  numeric id logged (used to fill `OWNER_SC_USER_ID`).
