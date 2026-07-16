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
- **Reposter names in the feed** — `/me/feed/tracks` exposes reposters
  only as bare URNs (`soundcloud:users:N`); showing names would need a
  cached `/users/{urn}` lookup per reposter. Skipped in M8 as not worth
  the extra API calls; revisit if the plain "↻ repost" chip feels flat.
- **Recently played** — views on top of `track_plays`
  (`ORDER BY last_played_at DESC` is already indexed).
- **Playlist search** — third search tab via `GET /playlists?q=`; needs a
  foreign-playlist detail path (the current `/playlists/[id]` page only
  resolves titles for your own playlists). Deferred from M13.
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

### Collection auto-continue (2026-07-16)

When a local collection queue ends (repeat off), the player can flow into
radio seeded from the track that just finished — a "continue with radio"
switch on the queue panel's up-next row, pref-gated
(`nimbus:pref:autoRadio`), off by default. Applies to all self-owned
collection kinds (likes/playlist/feed/search/artist —
`AUTO_CONTINUE_KINDS`/`canAutoContinue` in `lib/radio.ts`); radio
self-refills and shared/slipstream queues aren't ours to extend, and the
switch hides for those. The seed is **not replayed**: a new pure
`seedStation()` builds the station with the seed at position 0 already
consumed, `advance()` switches queues, awaits `refillRadio()` (all M8
machinery reused — shared in-flight promise, seed retries, tried-seed
set), then advances onto the first *related* track; the seed lands in
history so seed chaining works exactly as in a user-started station.
`startRadio` now uses the same constructor. A dry or transiently failed
refill restores the finished collection queue untouched (plus a quiet
toast when genuinely dry), and a fail-streak guard limits auto-continue
to clean track ends, so a queue that ends on a broken track can't seed a
station from it.

Validation: 380 tests green (5 new: total-over-SourceKind eligibility
map, station shape, no-replay advance, dry-station stop, seed-chain
parity); typecheck clean. Live playwright-cli pass, 2 plays total:
toggle off by default → last playlist track ended at "end of queue"
with no radio; toggle on → end transitioned onto a related track (not a
replay) with the `radio · {seed}` header and a 38-track station
persisted (seed consumed at position 0, position 1 playing), exactly
one play consumed by the transition; switch hidden on the radio queue;
pref and paused radio queue survived reload.

### Fourier scene: 2D spatial-frequency viz (2026-07-15)

New "fourier" stage scene (mode 6): the live spectrum is rasterized as a
rotating stripe field, run through a 2D image FFT (`lib/viz/fft2d.ts` —
radix-2, strided column passes, no transpose), and the log-magnitude
spectrum is what's painted: by the rotation theorem, a sweeping line of
harmonic dots that lunges on beats. On a confident tempo estimate the
base spin locks to the grid — one revolution per 16 beats, so the sweep
completes every four bars — easing back to the `spin` slider rate when
confidence drops (0 = still). A "roll" tune toggle swaps the
source for the scrolling spectrogram, whose 2D FFT is the modulation
spectrum — rhythm and tempo as a dot lattice; the spectrogram image
rotates through the same spin/kick state (`rotateField`,
nearest-neighbor back-sampling), so its lattice sweeps like the
stripes do. Field construction is
analytic (`lib/viz/fourier.ts`, no getImageData); mean subtraction
kills the DC spike, a separable Hann window (toggleable) suppresses the
boundary cross, and a fast-attack/slow-release peak normalizer holds
brightness steady. An "artwork" toggle multiplies the source field by
the album art's luminance (extracted once per track at grid
resolution), which convolves the art's own 2D spectrum onto every
harmonic dot — texture instead of points. A "bokeh" toggle runs
bloom-style FFT convolution (inverse transform via the conjugate
trick): the field's highlights are extracted, convolved with a small
sum-normalized art kernel, and layered back over the crisp base, so
bright dots bloom into art-shaped glints. Convolving the whole field
was tried first and reads as fog; sprite-splatting (tiny covers
stamped on peaks) was also built and cut on sight. Alongside: every
tune knob across all scenes now carries a `hint` (required on
`FieldDef`, so new knobs can't ship without one) shown as a hover
tooltip on the dotted-underlined label. Pixels colorize through an accent LUT with alpha
rising from 0 (backdrop shows through), n×n offscreen upscaled with a
cover transform. Grid 64/128/256 (256 computes every other frame); a
corner inset shows the source pattern being transformed. Presets:
orbit / lattice / crystal.

Validation: 22 new unit tests (impulse/cosine/Parseval/rotation-theorem
FFT checks, rasterizer determinism, normalizer silence clamp, LUT
ramp); full suite 358 pass, typecheck clean; visually verified via
playwright-cli in all three presets — stripes show the rotating
harmonic dot-line, roll shows the modulation lattice, tune knobs and
inset live-update.

### Piano polish + art-mode tune (2026-07-14)

Follow-ups: piano's backdrop artwork enlarged (~0.78 of the roll
region) and dimmed to 45% alpha so the lights clearly read as the
foreground; sidebar navigation now always closes the stage — StageView
watches the pathname for route changes, and AppShell's sidebar catches
link clicks to the page you're already on.

Piano defaults to beams ("roll" is now a preset/toggle away), the roll
note-gate is a tune knob (`gate`, 0.05–0.6 — soften for sparse genres,
raise for dense mixes), and the album art now anchors the space above
the keybed (centered, rounded, 85% alpha) with the beams/roll painting
over it. The settings registry widened from SceneId to StageMode so the
art mode has a tune too — drift/still presets around a "breathe" toggle
for the artwork swell. Registry-coherence tests now iterate STAGE_META,
so every mode must declare fields and presets.

### Piano roll + tune popover; waterfall retired (2026-07-14)

The waterfall scene is gone as a standalone mode — its idea lives on
inside piano as a sequencer roll (default on, "roll" tune toggle): key
lights stamp an offscreen canvas that scrolls upward (waterfall's
self-drawImage idiom turned vertical), so sustained notes extrude into
MIDI-style bars. Scroll speed follows the tempo grid when confident
(~8 beats visible, 4–12s clamp; steady 7s fallback) and confident beats
stamp faint grid lines. Only clear notes (post-noteContrast level > 0.3)
enter the history — the low shimmer stays on the live keys — with
integer-pixel columns and a fade that dissolves notes by the top. The
"beams" preset (roll off) keeps the original look. Tuning also moved
from the right-edge drawer to a compact popover anchored above the
"tune" button — controls appear where the cursor already is. Stage is
back to five modes (hotkeys 1–5); `lib/viz/colormap.ts` retired with
the scene; stale `stageMode: "waterfall"` prefs fall through to the
default via the existing validation.

Validation: typecheck + `bun test` (stage test now rejects "waterfall";
settings tests re-pointed at ridge); playwright-cli against live
playback — roll density/fade/beat lines, beams preset flip, popover
reachability, keyboard switching.

### Stage chrome redesign (2026-07-14)

Replaced the bottom-center pill cluster: mode switching is now a
bottom-left corner text stack (idle shows just the active mode's
lowercase name with an accent tick; hover/focus/tap unfolds the full
list plus the shortcut hint), tuning is a right-edge drawer with all
knobs always visible (no "advanced" disclosure), fullscreen pairs with
close top-right, and "tune" sits as quiet text bottom-right. Scene
switches flash the new name center-low (motion-safe only); chrome fades
in fast and out slow with a slight drift. Esc peels layers: drawer →
browser fullscreen → stage. Chrome-only — `lib/stage.ts`, scenes, and
settings resolution untouched.

Validation: typecheck + `bun test` green (no UI tests by convention);
playwright-cli pass over corner stack idle/expand/select, keyboard
switching + flash, drawer live-tuning, esc order, and pref persistence.

### Milestone 14 — piano scene (2026-07-14)

Fifth viz scene: a 49/61/72/88-key keyboard lit from the FFT. The trick
is in `resolveDsp` — 72 log-spaced bars over a quarter-tone-padded band
(`pianoBand`, `lib/viz/piano.ts`) makes each cava-pipeline bar exactly
one semitone, so bars[i] is key i with zero new aggregation code
(monstercat off so notes don't bleed across keys). `noteContrast`
(spectral contrast vs the ±4-semitone neighborhood, pure + tested)
keeps dense mixes from lighting the whole board: peaks pop, the
broadband bed shimmers faintly. Painting is beams scaled from a
unit-height gradient (soft tips, no per-frame gradient builds, no
shadowBlur), accent-lit keys running white-hot, felt strip blooming on
the tempo grid. Analyser fftSize 2048→8192 (semitone resolution to
~G2; smoothing 0.5→0.35 to offset the longer window) — config-only
per the topology rule; bars/ridge/waterfall/scope eyeballed fine after
the change, scope reads only its first 1536 samples.

Validation: `bun test` (viz-piano.test.ts: band/layout/contrast/
resolveDsp), typecheck, playwright-cli against live playback on all
five scenes + tune panel fields.

### Milestone 13 — search + artist pages (2026-07-14)

Debounced catalog search (tracks + artists tabs) at `/search`, and
`/artists/[id]` pages with avatar, follower/track counts, city/country,
follow/unfollow, and the artist's windowed catalog. Every artist name in
the UI links to the artist page (browse tiles/rows, media bar, stage —
side-panel queue rows excepted: they're real `<button>`s and links can't
nest); tracks without a cached `artistId` fall back to the external
SoundCloud profile link.

**Endpoint correction**: search is `GET /tracks?q=` / `GET /users?q=` —
the `/search/*` paths this file previously sketched don't exist in the
public API. Artist pages use `GET /users/{id}` + `/users/{id}/tracks`,
which accept plain numeric ids (verified live; no URN formatting
needed). Track search passes `access=playable,preview` to keep blocked
tracks out of results; artist catalogs show everything, greyed like the
library.

**Shape**: four seam methods (`searchTracks`, `searchArtists`,
`getArtist` + `getArtistFollowed`, `getArtistTracks`) with the standard
HMAC-bound cursors; routes `/api/search/{tracks,artists}` and
`/api/artists/[id]{,/tracks}`; windowed-list plumbing generalizing the
feed pattern (`lib/paged.ts`, `lib/hooks/usePagedList.ts` — register
only, never syncSource); new `search`/`artist` source kinds with
feed-like caps; `ProviderTrack.artistId` added optionally (all persisted
snapshots/caches validate it as optional for backfill). Navigation stays
minimal per the design line: a sidebar "search" entry, query/tab in the
URL via shallow `history.replaceState`, and a "← back" chip on artist
pages (`router.back()`, `/search` fallback) — no global nav chrome.

Validation: 327 tests green (18 new: source kinds/caps, query
normalization + sourceId encoding, page dedupe, count formatting,
legacy-snapshot backfill for queue + library cache); typecheck clean;
live pass — search → tabs → artist page → back chip restores query+tab
from the URL, follow/unfollow round-trip against the live API,
artist-name links from library tiles (needed a z-order fix over the
hover play overlay), and one artist-page play started and paused through
the normal quota path.

### Milestone 12.1 — AFK guard (2026-07-14)

Cost analysis of unattended clients: end-of-queue is already ~free (the
publisher's `enabled` gate sends one final `playing:false` beat and goes
quiet; the feed poll is `document.hidden`-gated), and playing-all-night
self-limits via the daily play quota (~7½ h of 3-min tracks) — but until
then burns the whole quota + ~4 beats/min, and **any client polling every
15s keeps Neon compute from ever autosuspending** (suspend needs ~5 quiet
minutes; a 24/7 visible tab ≈ 720 CU-h/month vs ~190 free). Fix, no new
infra: an interaction clock (`lib/hooks/interaction.ts` — module-level
pointer/key/wheel/touch listeners + `markInteraction()` from media-key
handlers) feeding a pure policy (`lib/afk.ts`): after **3 h** of playback
with no interaction the player silently pauses with a toast (heartbeats
stop for free; a paused shared-session host goes presence-stale and the
row revives on resume, same as reload); a **follower leaves** instead of
pausing so its 5 s snapshot poll stops too; and the visible-tab feed poll
skips ticks after **30 min** idle, resuming on the next tick after any
interaction. Track auto-advance is not interaction.

Validation: 309 tests green (6 new: threshold boundaries, paused/playing,
follow→leave, clock skew, feed<pause invariant); typecheck clean; live
pass with shortened constants (90s/30s/5s) — untouched playing tab
auto-paused on schedule (twice, including after a resume), request
stream ended with exactly the final `playing:false` beat then total
silence over 20s, feed polls stopped at the idle gate and resumed ≤15s
after one synthetic pointerdown. (Headless gotcha for posterity: POST
fetches don't appear in `performance` resource timing in headless
Chromium — instrument `window.fetch` instead.)

### Milestone 12 — shared slipstreams (2026-07-14)

Slipstream grows collaborative control. A host explicitly **shares a
session** (SidePanel button); joiners get full queue editing — add tracks
from their own browse views (credited "added by {name}"), remove, reorder
(hover ✕/↑/↓) — and next/prev/jump. Plain follows stay read-only and
unchanged.

**Architecture**: server-authoritative shared queue in a new
`slipstream_sessions` row (one per host; `queue` jsonb of
`QueueTrack & {addedBy}` capped at 100, seeded with the host's next 25;
`revision` bumps on every change) + a one-slot LWW transport-control
intent (`control`/`control_seq`; "play" carries an explicit target so
concurrent skips coalesce). The host's audio element remains the only
clock: the host's shared queue is a real local `QueueState`
(`sourceId: "shared"`), so the publisher, persistence, and the follower
sync engine (`lib/slipstream.ts` — zero changes) all ride unchanged.
**No new poll loops**: while sharing, the publisher keepalive drops to 5s
and the heartbeat POST response doubles as the host's state poll (queue
embedded only when `sharedRev` is behind; pending control included by
seq); followers pass `?rev=` on the existing 5s snapshot GET and the
queue piggybacks only on change. A plain (non-shared) heartbeat deletes
the sender's session row, so stale sessions self-heal; liveness always
requires fresh presence. Reorder is revision-checked under a
`FOR UPDATE` row lock (`lib/shared-session-store.ts`) → 409
(`ConflictError`, new) on races; add/remove are id-based and idempotent.
Host 422s auto-remove the entry from the shared list. Quick host reload
revives the session (`GET /api/slipstream/session` when a persisted
`"shared"` queue rehydrates). Queue/control writes require an HMAC-signed
capability bound to the authenticated user, host, and concrete session
generation; joining/revival issues it, and restarting a session invalidates
old capabilities at the database row. Shared attribution URLs are restricted
to canonical HTTPS SoundCloud hosts before storage. Pure engine
`lib/shared-queue.ts`
(mutations, host reconcile `applySharedOrder`, wire validation reusing
the window's XSS-safe `parseQueueTracks`, now exported). New caps kinds:
`shared` (host: no shuffle/repeat — they'd rewrite the agreed order) and
`slipstream-shared` (guest: skip/jump as intents, no seek). Routes:
`POST/DELETE/GET /api/slipstream/session`,
`POST /api/slipstreams/[userId]/queue`,
`POST /api/slipstreams/[userId]/control`; snapshot/feed/heartbeat
extended. Guests see a `shared` chip in "listening now", a downgrade
toast if the host stops sharing, and a "queue for session" hover
affordance on tiles/rows.

Validation:

- 303 unit tests green (34 new: shared-queue add/remove/reorder edges,
  applySharedOrder replay/prune-race/position/dedupe invariants, control
  + queue-op wire validation incl. external/spoofed-link rejection,
  user/host/session-bound capability integrity and restart invalidation, caps rows,
  heartbeat `sharedRev`/`controlSeq` fields); typecheck + production
  build clean; schema applied twice over live data.
- Routes (curl, minted sessions): 401 anonymous on all new routes;
  session restart bumps revision (1→2, never aliases); add duplicate /
  add current-track / XSS URL / non-permutation → 400; stale-revision
  reorder → 409; control self-target → 400, dead host → 404; shared
  heartbeat prunes exactly the played entry and bumps revision once;
  plain heartbeat deletes a lingering session row; remove is idempotent
  (no revision bump on no-op).
- Two-browser (playwright-cli, owner + member sessions): host shares
  mid-track without audio interruption (queue swaps to 25-entry seed);
  guest sees the shared chip, joins at the host's playhead, adds a track
  from their own likes ("added by Dev" on both sides ≤1 beat), removes
  and reorders with both sides converging ≤5s; guest "next" advanced the
  host's audio ≤5s and popped exactly one entry; stop-sharing downgraded
  the guest to read-only follow (toast + disabled transport) while
  playback continued. Seed policy fix caught live: seeding the full
  100-entry cap from a big likes queue left no addable slots → seed is
  now 25.

### Milestone 11 — library view toggles (2026-07-14)

Two persistent display toggles in the likes/playlist browse views, in a
slim toolbar row between the header and the collection: **grid ⇄ list**
(new `TrackRow` — 40px artwork, hover play overlay + radio affordance,
equalizer bars on the current track, duration; same props and
interaction contract as `TrackTile`) and **hide unplayable** (render-level
filter with a "showing N of M" cue; header counts, shuffle/play-all, and
queue behavior untouched — PlayerProvider already filters `streamable`).
Prefs are global across likes/playlists (`nimbus:pref:browseLayout`,
`nimbus:pref:hideUnplayable`) via a small `useBrowseDisplayPrefs` hook
following the AppShell hydration pattern. Feed view deferred.

Validation: typecheck + tests green; playwright pass — list rows
play/pause/radio correctly, hide toggle shows "showing 599 of 627" with
header counts unchanged, windowing paginates past 50 with the filter on,
prefs survive reload and apply on playlist pages, unavailable rows out of
tab order.

### Milestone 10 — player bar & loudness (2026-07-14)

**Volume leveling** (`lib/loudness.ts`, pure + tested): gated-RMS loudness
estimation (blocks below −55 dBFS ignored) toward a −14 dBFS target, gain
clamped −12…+6 dB, applied through a new GainNode + limiter
(`source → analyser → gain → limiter → destination` — analyser taps
pre-gain so viz behavior and measurements stay source-referenced). The
player samples the analyser every 250 ms while playing, ramps gain as the
estimate converges, and LRU-caches per-track loudness (500 entries,
`nimbus:pref:loudness`) so replays seed instantly. Measurements divide out
`el.volume²` — element volume scales the signal *before* the graph — and
skip muted blocks. Toggle ("auto-level", default on) lives in the volume
cluster. **Perceptual volume**: `el.volume = slider²`; state/persistence
stay in slider domain. **hls.js preferred over native HLS**: Chrome 142+
ships built-in HLS whose pipeline does not feed MediaElementSourceNode
(analyser reads silence → viz + leveler dead), so `loadStream` uses hls.js
wherever MSE exists and falls back to native only on MSE-less browsers
(iOS Safari). **Media bar redesign**: inline volume slider (hover flyout
removed), queue toggle moved from the shell's floating top-right into the
bar (live dot preserved), like + follow-artist buttons replace copy-link,
mini viz centered between the track-info icons and transport (equal flex
spacers; toggles the stage, as does the artwork thumb). **Like/follow**:
provider methods verified against the official OpenAPI spec —
`POST/DELETE /likes/tracks/{id}`, `PUT/DELETE /me/followings/{id}`, status
via `GET /tracks/{id}`.`user_favorite` + `GET /me/followings/{id}`
(200/404); routes `GET /api/tracks/[id]/social`,
`PUT|DELETE /api/tracks/[id]/like`, `PUT|DELETE /api/artists/[id]/follow`
(same-origin-gated mutations); optimistic UI with revert toasts.
**Stage chrome**: top-right close button, real `requestFullscreen` toggle
on the stage element (esc exits fullscreen first, stage second). **DSP**:
default spectral tilt 3 → 1.5 dB/oct everywhere (the +3 M9 setting read
top-heavy); smooth/punchy presets keep their explicit values.
Validated via playwright against the live API: follow round-trip net-zero,
loudness estimates reproducible within 0.2 dB across sessions, layouts
checked at 1300×750 and 1920×1080.

### Milestone 9 — viz overhaul (2026-07-13)

The stage grows up. **Chrome**: track title/artist moved to the top-left,
keyboard hint tucked into the bottom-right corner below the picker row's
baseline (can't collide with the centered pill cluster), scene picker +
new "tune" button stay bottom-center. **Per-scene width**: `SCENE_META`
carries an optional `maxWidth` (spectrum/ridgeline 1280, scope 1100,
waterfall full-bleed); StageView centers SceneHost in a capped column
while the blurred-art backdrop stays full-bleed. **DSP rebalance**
(`lib/viz/dsp.ts`, still cava-derived): +3 dB/oct spectral tilt
referenced to 1 kHz (kills the bass slam at the source), tanh soft-knee
from 0.8 replacing the hard clip, tamer autoscale (max sens 8→6, growth
0.4→0.15/s, pull-back only when ≥2 bars run hot so a lone bass bar can't
pump the whole display). Tunables mutate live via
`SpectrumProcessor.setTuning`; structural changes (bar count, band edges)
rebuild in `FrameAnalyzer` with sensitivity carried over. Mini-viz
inherits everything. **Scenes**: orbit (radial) and drift (particles) are
gone — replaced by **ridgeline** (Unknown Pleasures stacked silhouettes;
`SpectrumHistory` ring buffer, time-based row commits, max-pool
downsampling, occluding fills, live front ridge) and **waterfall**
(scrolling spectrogram on a small offscreen canvas through an
artwork-accent colormap LUT, aurora via bilinear upscale). Stale
`stageMode` prefs fall back to "art" through the existing validator.
**Settings**: presets + advanced knobs per scene
(`lib/viz/settings.ts` — one versioned pref payload of
`{preset, overrides}` per scene, field defs drive both clamping and the
hand-rolled panel; visual knobs flow per-frame via `SceneContext.settings`,
DSP knobs via SceneHost → analyzer, spectrum-only by design). **Tempo**
(`lib/viz/tempo.ts`): IOI-histogram estimator (70–180 BPM fold, decaying
evidence, parabolic peak, phase-locked grid); `AudioFrame.tempo` is null
unless confident, and scenes pulse on the predicted grid via `beatPulse`
with raw-onset fallback. **Waveform lookahead**: new provider method
`getWaveform` (probe finding: `waveform_url` is a PNG on
`wave.sndcdn.com`; the `.json` sibling returns `{width, height: 140,
samples[1800]}` with `Access-Control-Allow-Origin: *` — still brokered
server-side since that variant is undocumented), route
`GET /api/tracks/[id]/waveform` returns a normalized `TrackShape`
(98th-percentile envelope, hysteresis quiet/loud sections, drop
candidates) or `{shape: null}`; StageView fetches only while the stage is
open (module-level cache), scenes read `SceneContext.track` and lean in
~2 s ahead of a known drop via `dropAnticipation`. Everything degrades
gracefully when tempo/shape are absent.

Validation:

- 258 unit tests green (49 new/updated across viz-dsp tilt/soft-knee/
  autoscale, viz-history ring semantics, viz-colormap ramps,
  viz-settings validation/clamping/preset layering, viz-tempo trains/
  jitter/folding/ramps/staleness, viz-trackshape envelopes/sections/
  drops/queries); `tsc --noEmit` clean; production build clean.
- playwright-cli pass at 1440 and 2560 wide: chrome positions with no
  overlap (a tune-button/hint collision was found and fixed by moving
  the hint below the pill baseline), spectrum/scope centered column vs
  waterfall full-bleed, all five modes cycle via arrows, tune panel
  applies presets/sliders live and suppresses the chrome auto-hide,
  payload persists in `nimbus:pref:sceneSettings`, mini-viz no longer
  bass-slammed, waveform route returns a real shape end-to-end.
  (Headless gotcha: element volume was 0, which silences the analyser —
  not a regression.)

### Milestone 8 — track radio + feed (2026-07-13)

Discovery arrives, composed from the two endpoints the public API actually
offers. **Track radio**: an infinite station started from any track (tile
hover affordance + media bar button). The queue itself is the station's
memory — `lib/radio.ts` is pure selectors over `QueueState` (low-water
refill at ≤5 playable remaining, 500-track soft cap bounding the persisted
payload, seed chain current → history newest-first → original seed).
`PlayerProvider.refillRadio` shares one in-flight promise between the
low-water prefetch effect and the end-of-queue fallback in `advance()`;
related fetches are discovery calls that never touch quota or the
5-failure streak. The M5 radio CAPS row went live unchanged (skip/seek
yes, jump/shuffle/repeat no). **Feed**: `/feed` page of uploads + reposts
from followed users (`useFeed` — paged, never walk-to-completion, no IDB
cache since a feed's value is nowness; scroll auto-loads 6 pages then an
explicit "load more"; repost echoes dedupe by track id, first appearance
wins, "↻ repost" chip). Queue metadata for self-contained sources (radio,
feed) now persists in `nimbus.queue.v1` (`tracks` snapshot, additive) and
restores into the metadata cache on reload — driven by a new
`restoresFromLibrary` capability, so slipstream windows and the queue
panel stay painted. New provider methods `getRelatedTracks`/`getFeedPage`
(raw activity-wrapper shapes stay in `lib/soundcloud/`), routes
`GET /api/tracks/[id]/related` and `GET /api/feed` (withUser + cursor,
no quota). TrackTile's root became a `role="button"` div so the radio
affordance can be a real button (buttons can't nest).

Probe findings (recorded for posterity): `/tracks/{id}/related` honors
`limit` + `linked_partitioning` with offset-based `next_href`, returns
full bare tracks, is finite per seed (~20–40) — hence seed chaining; many
items are `access: "preview"` (existing streamable policy applies).
`/me/feed/tracks` returns activity wrappers `{type: "track" |
"track:repost", origin: <full track>, reposter?: <bare URN string>,
created_at}` with cursor-based `next_href`; reposter names are not
available without per-URN lookups.

Validation:

- 207 unit tests green (26 new: radio engine boundaries/seed
  ordering/cap truncation, feed dedupe, sources feed kind +
  `restoresFromLibrary` rows, queue metadata snapshot round-trip +
  malformed-entry filtering); typecheck + production build clean.
- Routes (curl, minted session): anonymous → 401 on `/api/feed` and
  `/api/tracks/{id}/related`; malformed cursor → 400; non-numeric and
  negative track ids → 400; authed responses carry only normalized
  provider fields (no raw SC leakage); feed page deduped 29 items with a
  working cursor; related returned 39 tracks for the probe seed.
- Live (playwright-cli, minted session, plays kept minimal): feed page
  renders uploads + reposts with "↻ repost" chips and active sidebar
  link; tile hover shows play + start-radio affordances; starting radio
  from a feed tile played the seed immediately and filled "up next ·
  radio" with related tracks, header "radio · <seed title>"; reload
  restored the full station with artwork/titles from the persisted
  snapshot, correctly paused. Deeper refill/skip loops were left to unit
  coverage to spare play quota.

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
stage runs _inside_ the shell (`StageView` overlays only the main content
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
only shrinks on a _completed_ walk. New pure `integrate()` in
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
  - build clean.
- Schema applied idempotently (twice) over live data.
- Routes (curl, minted sessions): anonymous → 401 on all three; malformed
  /oversized-window heartbeat → 400; self-snapshot → 400; missing/stale
  host → 404; keepalive-without-window preserves the stored window
  (COALESCE); pause beat drops the host from the feed immediately.
- Host publishing (live browser): row upserts on play with real track +
  10-track window; pause writes playing:false; keepalive bumps updated_at.
- Follower (two sessions, real tracks): join landed ~0.5 s off the
  extrapolated host playhead; host track change propagated in ≤1 poll; an
  unresolvable window lead 422'd, consumed an attempt, and was skipped
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
  `playCount: 2`; a failed (422) resolution creates no tally but consumes an
  attempt
  the quota counter.
- Persisted queues from before the change load as `classic` without
  wiping state.

### Milestone 3 — invites, quotas, admin (2026-07-12)

Single-use invite links (7-day expiry, revocable; code rides the signed
OAuth dance cookie) replace the single-owner gate; `OWNER_SC_USER_ID`
now identifies the owner/admin. Per-user (default 150/day) and global
(default 12,000/day — headroom under SoundCloud's 15,000 client cap)
stream-start quotas, enforced atomically before stream resolution with
attempt-counting and friendly 429s. DB-backed membership checks cut off
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
  failed resolutions consume an attempt; the player toasts and pauses on 429 (never
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
