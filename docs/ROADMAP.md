# Roadmap & milestone log

The living tracker for nimbus. Add ideas under **Next / ideas**; when a
milestone ships, move it to **Shipped** with its date and validation
record. The README stays a clean front page — history lives here.

## Infrastructure (decided 2026-07-13)

Nimbus stays on **Neon + polling** — researched and settled, don't
relitigate without a trigger. Neon's free tier is stable and improving
post-Databricks, and it's Vercel's blessed Marketplace Postgres; Supabase
free pauses projects after 7 idle days (data-loss hazard at friends
scale); Edge Config/Blob have no use case here. Slipstream's polling
transport is the light option at this scale: Vercel's WebSocket beta
(June 2026) has no fan-out/presence primitive (their own guide bolts on
Redis), and Neon LISTEN/NOTIFY dies with free-tier autosuspend.

If push is ever wanted: keep Postgres as source of truth, publish a
change-ping from the heartbeat POST handler, followers subscribe and
fetch — Ably first (free 200 conns/6M msgs, presence, ~half a day), then
Cloudflare Durable Objects/PartyServer, then Upstash. Revisit triggers:
(1) ≤5s skip propagation feels laggy in real sessions; (2) >~20
concurrent users; (3) Vercel ships first-party pub/sub; (4) Vercel
Hobby **Active CPU** (4 hrs/month — the tight quota; overage pauses the
project 30 days) trends toward its cap in the dashboard.

## Next / ideas

- **Slipstream follow-ups** — private-listening opt-out toggle (one
  `users` column + a `WHERE`, the heartbeat POST early-returns); preview
  badge for `access: "preview"` tracks (30s snippets via the API).
- **Feed / reposts / related-track continuation** — keep playback going
  past the end of a collection.
- **Recently played** — views on top of `track_plays`
  (`ORDER BY last_played_at DESC` is already indexed).
- **Tauri client** — native shell on this same backend.
- **Cast to TV (Google Cast)** — play the stage + viz on a television.
  Shape: a Custom Web Receiver (a small self-hosted page — can be a route
  on this same Vercel app; $5 one-time Cast Developer Console
  registration, dev devices registered by serial), with the existing app
  as sender via the Cast Web Sender SDK (Chrome-only, HTTPS — both
  already true). The sender resolves plays through the normal
  `/api/tracks/[id]/play` quota path and ships the signed CDN URL to the
  receiver over the Cast custom-message channel; the receiver's `<audio>`
  streams direct from the CDN, so the token-broker constraint holds and
  no realtime infra is needed (the Cast channel is device-local). The
  receiver is Chromium, so `lib/viz/` and the scenes reuse unchanged —
  the M1 CORS verdict (`cf-media.sndcdn.com` serves ACAO:*) should carry
  over, but verify `MediaElementSource` on real hardware first. Main
  risk: weak CPUs on old Chromecast dongles — plan a "TV profile" of the
  SceneHost throttles (fewer bars/particles, 30fps cap); recent
  Google TV devices are fine.

Direction decisions (2026-07-13): **mobile is out of scope** for now —
nobody in the friend group wants it. **Viz stays pure TS + AnalyserNode —
no WASM**: the FFT is already native in the analyser, the TS layers do
~400k ops/sec total, and frame cost is canvas painting, which WASM can't
touch. If viz perf ever hurts: tune the existing adaptive throttles →
OffscreenCanvas worker → WebGL/WebGPU → only then WASM+SIMD. Staying
plain-web also keeps a future Cast receiver a plain page.

## Shipped

### Milestone 7 — ambient art shell (2026-07-13)

Artwork became the design system (absorbs the old "visualization redesign
pass" idea). The current track's art is a blurred, dimmed, slowly
drifting backdrop behind the whole shell (`AmbientBackdrop` +
`CrossfadeArt`, decode-then-crossfade so tracks never pop; neutral
gradient fallback); sidebar, media bar, and panels are translucent glass
(one `@utility glass` token, alpha modifiers elsewhere — backdrop-filter
only on non-scrolling chrome). Queue and slipstream presence unified into
one right-side `SidePanel` ("listening now" rows with join/leave above
the queue; accent dot on the bar toggle when anyone's live; sidebar
slimmed to nav + playlists). Media bar decluttered: mini visualizer
always on and clickable, volume collapsed to an icon + flyout, one
expand button; `vizMode` tri-state replaced by `stageOpen`. The
fullscreen viz became the **stage** (`FullscreenStage`, `lib/stage.ts`):
an "art" mode — sharp artwork floating over its own blurred fill,
album-art-screensaver style, opened by clicking the player thumbnail —
plus the four scenes, all now painting on transparent canvases over the
art backdrop (clearRect / destination-out trails; orbit's disc floats
over its own blur). Fullscreen track credits upgraded to real SoundCloud
links (previously plain text). HeaderBand's averageColor tint band
retired (superseded by the ambient layer; `averageColor()` deleted,
`extractPalette` stays for viz theming). Scene prefs migrate
(`vizScene` → `stageMode` fallback read). Polish rider from first local
try-out: icons swapped to lucide-react behind the same `Icon*` wrappers
(`components/ui/icons.tsx`); the queue/slipstream panel promoted from
overlay to a persistent collapsible layout column (open by default,
`queuePanel` pref, reopen button floats top-right of the main view when
collapsed — this also removed the `bottom-[88px]` bar-height coupling);
media bar grew to h-24 with bigger transport and thumb; volume flyout
overflow fixed (a viewport-edge flyout caused a horizontal scrollbar) and
volume moved to lead the right cluster, which is now column-centered; the
stage runs *inside* the shell (`StageView` overlays only the main content
area — sidebar, queue, and media bar stay); a slim pinned header (artwork,
title, count, compact shuffle/play) fades in when the browse header
scrolls away; shuffle got an on-dot, a bigger mode chevron, and an
explicit "off" row in the mode menu; the shell's floating menu/queue
buttons anchor at the row level so they no longer scroll with content;
tile minimum 200px.

Validation:
- 179 unit tests green (3 new: stage-mode strip, cycling, validation);
  typecheck + production build clean; queue/slipstream/DSP tests
  untouched.
- Visual pass (playwright-cli, minted session): idle fallback gradient;
  backdrop follows the playing track through the glass shell; side panel
  shows queue rows (and live section when hosts exist); art stage opens
  from the player thumbnail with idle-fading chrome and working mode
  pills/arrow keys; spectrum + orbit render over visible art instead of
  black (caught and fixed a stacking bug where absolute backdrop layers
  painted over the in-flow canvas); admin cards legible on glass; 400px
  viewport still functional (drawer, single-column grid, compact bar).

### Milestone 6 — full-library shuffle (2026-07-13)

Shuffle now covers the entire collection instead of the first loaded page.
Page size bumped to SoundCloud's 200 max; `useLibrary`
(`lib/hooks/useLibrary.ts`, replacing `useTrackPages`) walks every page of
a source when it opens and persists the normalized list in IndexedDB
(`lib/idb.ts`, hand-rolled wrapper) keyed per user+source. Next session
hydrates instantly from cache; a live first-page check
(`lib/library-cache.ts`: pure freshness policy, 24h TTL, 30-day eviction)
decides whether the cache stands or a fresh walk runs — the displayed list
only shrinks on a *completed* walk. New pure `integrate()` in
`lib/queue.ts` mixes late-arriving pages into the unplayed remainder of a
shuffled queue (seeded, deterministic) instead of piling them at the tail;
removals stay confined to the new `syncSource` player action, which only
ever sees complete lists. BrowseView keeps windowed rendering (the data is
all in memory; the DOM grows by 50 tiles via the existing sentinel).

Validation:
- 176 unit tests green (24 new: `integrate` insertion bounds/permutation/
  determinism/dedupe, cache validator, page merge, first-page-change and
  skip-walk truth tables); typecheck + build clean.
- Live (playwright-cli, minted session): library shows the full
  626 tracks · 598 playable (was 50); reload renders the full count
  instantly from IndexedDB and issues exactly one first-page check;
  decoded cursor confirms SoundCloud honored `page_size=200`; Shuffle
  produces a persisted queue with all 598 playable ids
  (`order`/`sourceOrder` length 598, shuffled, position 0).
- Existing persisted `nimbus.queue.v1` payloads load unchanged (no state
  shape change).

### Milestone 5 — slipstream: shared live listening (2026-07-13)

A live "listening now" sidebar feed of what members are playing (always-on
presence via heartbeats), and joinable slipstreams: follow a member's live
queue read-only, position-synced over polling. Pure sync engine
(`lib/slipstream.ts`: expected-position extrapolation with server-clock
offset, drift-seek, optimistic-advance + early-end holds); per-source
capabilities seam (`lib/sources.ts`) gates transport UI and paves the way
for radio/related continuation; one upserted presence row per host with a
10-track jsonb window (metadata only — every listener resolves streams via
their own token and quota; publisher is inert while following, so chained
follows are impossible by construction). Joining parks the local queue
(state, localStorage, and in-track position untouched); leaving or host
staleness restores it exactly. Riders: collapsible sidebar sections,
design north star in CLAUDE.md, plain-text README tagline (Spotify
comparison dropped).

Validation:
- 152 unit tests green (36 new: sync-plan precedence, holds, drift
  boundaries, window advance, heartbeat validation; caps rows); typecheck
  + build clean.
- Schema applied idempotently (twice) over live data.
- Routes (curl, minted sessions): anonymous → 401 on all three; malformed
  /oversized-window heartbeat → 400; self-snapshot → 400; missing/stale
  host → 404; keepalive-without-window preserves the stored window
  (COALESCE); pause beat drops the host from the feed immediately.
- Host publishing (live browser): row upserts on play with real track +
  10-track window; pause writes playing:false; keepalive bumps updated_at.
- Follower (two sessions, real tracks): join landed ~0.5 s off the
  extrapolated host playhead; host track change propagated in ≤1 poll; an
  unresolvable window lead 422'd, refunded quota, and was skipped
  in-window silently; local pause stuck across polls; leave and
  host-went-stale both restored the parked queue — persisted queue state
  byte-identical, playback resumed at the parked in-track position;
  reload while following landed on the local queue, not following;
  `nimbus.queue.v1` never contained a host track.
- UI (playwright-cli): feed hidden when empty; inert "(you)" row; active
  host row accent + leave; transport/seek disabled while following with
  read-only queue panel ("up next · from {host}", parked-queue return
  strip); sidebar sections collapse/expand with persisted state.

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
