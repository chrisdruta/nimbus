# Cast to TV (Google Cast) — implementation plan

Status: M-a + M-b shipped and working on real hardware (2026-07-17):
audio, handoff, transport, device volume, scene control from the
sender, up-next strip. Remaining: per-scene TV performance (see below)
and the deferred M-c items. Companion to the "Cast to TV" entry in
`ROADMAP.md`.

## Open: TV scene performance (next session's starting point)

Per-scene state on the Google TV Streamer after the first tuning pass
(TV profile dpr 0.75 / 40 bars / 30fps cap; lowPower flag skipping
bars' beat bloom and scope's glow strokes; roundRect polyfilled):

- **ridge, fourier: smooth.** art: free.
- **bars: still ~15fps and reads as lagging behind the audio.** The
  bloom skip wasn't it. Next suspects: FrameAnalyzer's per-frame work at
  fftSize 8192 (≈4096-bin aggregation loops in JS — trivial on desktop,
  maybe not here), and the ~186ms analysis window + smoothing reading
  as audio delay. Idea: receiver-specific analyser config (fftSize
  2048/4096 via a buildAudioGraph option) — piano is the only scene
  needing 8192's semitone resolution.
- **scope: borderline** after the glow skip. Trail (full-canvas
  destination-out per frame) is the remaining full-screen op.
- **piano: renders (polyfill works) but laggy** — dozens of
  roundRect+gradient key draws per frame, plus it *does* need fft 8192.
  Maybe a reduced-key TV variant.

Profile properly instead of guessing next time: the receiver is
inspectable on registered dev devices — cast, then chrome://inspect
(add `<tv-ip>:9222` under network targets) → Performance tab on the
live receiver. `[nimbus-cast]` console breadcrumbs show the message
flow; `?debug=1` on a desktop tab stubs CAF for message-injection
testing without hardware.

## Hardware findings (Google TV Streamer, 2026-07-17)

- **The Cast Web Runtime is old and hides its version.** Its UA is a
  bare `AppleWebKit/537.36` string with no `Chrome/XX` token. Bracketed
  empirically: ES2022 class static blocks (Chrome 94+) crash the parser;
  `??=` (Chrome 85+) runs — so the engine is ~85–93. Hence the
  `"browserslist": ["chrome 87"]` pin in package.json: **do not remove
  it** or the receiver bundle stops parsing on the TV and every cast
  launch dies in the platform's ~10s timeout with a blank-but-rendered
  page (SSR HTML shows, JS never runs).
- **Tailwind v4 output doesn't parse there either** (oklch, color-mix,
  @layer need Chrome 111+), so ReceiverApp styles itself with plain
  inline CSS and a local decode-then-swap artwork component — keep the
  /cast surface Tailwind-free.
- **The custom pipeline works on hardware**: hls.js → MSE → audio
  element plays, and the receiver's `ready` handshake needed the
  SENDER_CONNECTED re-announce plus a 3s sender-side fallback (a boot
  broadcast races the channel and drops).
- Boot/UA probes on /cast are gated behind `?debug`; the on-screen
  error line always renders on failure (TVs have no console — the
  receiver page must self-report).

## Context

The roadmap shape puts the viz **on the TV**: a Custom Web Receiver page hosted
as a route on this same Vercel app renders the stage + scenes with its own
`<audio>` + AnalyserNode, reusing `lib/viz/` unchanged. The sender's viz idles
while casting (scenes already idle gracefully on silence) and needs only a
"casting to <device>" state. Audio flows TV → CDN directly from the signed URL
the sender resolves through the normal quota path — token-broker holds, and the
Cast channel is device-local, so no realtime infra.

**Overall estimate:** ~4–5 dev-days across two milestones plus one optional,
with one hardware-verification session per milestone (real TV + deployed
build). The one true unknown is whether `MediaElementSourceNode` feeds the
analyser on real Chromecast hardware — everything else is verifiable in the
devcontainer.

## Key design decisions

### D1 — Receiver: fully custom pipeline; CAF for session + messaging only

Plain `<audio crossOrigin="anonymous">` + hls.js + our own audio graph on the
receiver; `CastReceiverContext` handles session lifecycle and one custom JSON
namespace (`urn:x-cast:com.nimbus.cast`). No `PlayerManager` /
`<cast-media-player>`.

Rationale: the milestone's whole point is viz on the TV, and only this path
reuses the sender's *proven* hls.js → MSE → MediaElementSourceNode chain
(PlayerProvider documents why native pipelines are hazardous here — native HLS
doesn't feed MediaElementSourceNode). CAF's player has no documented
media-element access and may not feed Web Audio — same hazard class,
unverifiable until hardware. Cost: no TV-remote/Google Home control in v1 (the
sender is the remote — fine, it started the cast). Device volume still works
via `RemotePlayerController.setVolumeLevel` (session-level, pipeline-
independent). Must pass `disableIdleTimeout: true` to `ctx.start()` or CAF's
idle reaper kills the app mid-track.

Fallbacks, in order: (1) PlayerManager LOAD + media-element tap; (2) ship audio
+ art-mode stage (needs zero audio signal), viz-on-TV hardware-gated. Casting
itself is never broken.

Wire protocol (type-discriminated JSON, validated by pure functions):

- sender→receiver: `load {trackId, url, protocol, positionMs, gainDb, track
  meta, shape?}`, `play`, `pause`, `seek {ms}`, `scene {mode}` (M-b), `stop`
- receiver→sender: `status {trackId, positionMs, playing, buffering}` (1s
  beat), `ended`, `error {code}`, `ready`

### D2 — Sender seam: thin branches in PlayerProvider, engine in `lib/cast.ts`

Queue machinery (advance, radio refill, autoRadio, fail streak, markUnplayable)
untouched — casting only swaps what "output" means. Branch point is
`resolveAndPlay` only: after a successful resolve, if casting → send `load` and
blank the local element instead of `loadStream`/`play()`. Receiver `ended` →
`advanceRef.current()`; the receiver never knows about queues.

New position seam: `PlayerRefs.positionMsNow()` + `actions.seekTo(ms)` (local
element normally, cast extrapolation while casting) — SeekBar switches to
those; the same seam feeds `buildBeat` so slipstream presence stays truthful.
Volume routes to device volume while casting; leveler measurement loop gains a
`&& !cast` gate.

Handoffs: cast start ships the URL the sender already holds (`lastStreamRef`)
at the current position — zero extra quota; cast end parks position via the
existing pendingSeek machinery, paused (no auto-resume, mirrors
slipstream-leave semantics).

### D3 — Viz on TV

Decouple SceneHost from player contexts via props (`analyserRef`, `playing`,
`getPositionSec`, `maxFps`, `fixedDpr`) — ~20-line diff, StageView passes them
from the hooks it already uses. Receiver stage: CrossfadeArt backdrop + palette
accent derived on-receiver from the same artwork + SceneHost + lowercase
chrome. TV profile: 30fps cap, dpr 1, 48 bars, `bars` default scene; constants
in `lib/cast.ts`.

### D4 — Sender UX

`CastButton` in the MediaBar right cluster (hidden when SDK absent/no devices,
accent-tinted when connected). StageView shows a quiet "casting to {name}"
panel; mini-viz dims. Cached per-track loudness ships as `gainDb` in the load
message (schema in M-a, applied on receiver in M-b).

### D5 — Slipstream / shared-session interplay: disallowed in v1

Pure `canStartCasting({following, hostingShared})` gates the button (disabled +
title); joining/hosting while casting no-ops with a toast. Natural M-c unlock
since `positionMsNow` already abstracts the beat clock.

### D6 — Expiry / errors

Receiver error → sender re-resolves once per track+position
(`shouldReresolve`, pure, tested — no quota loops), reloads at last status
position; otherwise flows into today's error path (fail streak, five-failure
stop, quota-429 pause all unchanged). Session disconnect = cast end.

### D7 — Registration, CSP, routes, dev loop

- Cast Developer Console ($5 one-time): register a Custom Receiver at the prod
  `/cast` URL; register device serial(s); app id in `NEXT_PUBLIC_CAST_APP_ID`
  (env only, no new stores). Do this on day one — serial propagation takes
  15 min–hours + device reboot.
- CSP (`proxy.ts`): sender `cast_sender.js` is inserted by our nonced bundle →
  `'strict-dynamic'` should trust it (verify on prod; fallback: add gstatic to
  script-src). Receiver: **exclude `/cast` from the matcher** — CAF needs a
  local platform WebSocket + gstatic scripts; forgetting this fails invisibly
  as a black TV screen. Document in the proxy comment.
- `/cast` is a bare route outside `(shell)` (whose layout redirects anonymous)
  — unauthenticated TV surface, receives only signed CDN URLs device-locally.
- Dev loop without hardware: receiver page gets a `?debug=1` harness — CAF
  stubbed, click-to-start gate (autoplay policy), message-injection console
  (paste JSON or fetch `/api/tracks/[id]/play` same-origin with the dev
  session). The entire receiver (graph, hls.js, scenes, TV profile) is
  testable in headless playwright.

## Milestone M-a: audio + protocol + receiver skeleton + sender seam
(~2.5–3 dev-days + registration + hardware session)

New files:

- `lib/cast.ts` (~180 LOC, pure, tested) — namespace/app-id constants, wire
  types + validators, `castPositionMs` extrapolation, `canStartCasting`,
  `shouldReresolve`, TV profile constants.
- `tests/cast.test.ts` (~150 LOC) — wire accept/reject tables, extrapolation
  (playing/paused/skew), gating truth table, single-retry policy.
- `lib/stream-load.ts` (client-only, ~80 LOC) — `loadStreamInto(el, stream)`
  extracted verbatim from PlayerProvider `loadStream`, shared by both sides.
- `lib/audio-graph.ts` (client-only, ~50 LOC) — `buildAudioGraph(el)`
  extracted from `ensureGraph`.
- `lib/hooks/useCastSender.ts` (~200 LOC) — SDK script load
  (`cast_sender.js?loadCastFramework=1`, `__onGCastApiAvailable`), CastContext
  (`ORIGIN_SCOPED` auto-join), session events, messaging, device volume;
  degrades to "no cast" cleanly.
- `components/player/CastButton.tsx` (~60 LOC).
- `app/cast/page.tsx` (~30 LOC) + `components/cast/ReceiverApp.tsx` (~280 LOC)
  — audio + graph + stream-load + `CastReceiverContext` (+ debug harness),
  art-mode stage, 1s status beat, error reporting.

Modified: `PlayerProvider.tsx` (~+120/−30: cast state slice, resolveAndPlay
branch, ended/error/status handlers, togglePlay/seekTo/positionMsNow/volume
routing, handoffs, gates; loadStream/ensureGraph bodies swap to the extracted
modules), `SeekBar.tsx` (+15), `VolumeControl.tsx` (+10), `MediaBar.tsx` (+8),
`StageView.tsx` (+25 casting idle state), `proxy.ts` (matcher exclusion),
`package.json` (`@types/chromecast-caf-sender`,
`@types/chromecast-caf-receiver`), Vercel env `NEXT_PUBLIC_CAST_APP_ID`.

## Milestone M-b: viz on TV + TV profile (~1.5–2 dev-days + hardware session)

- `SceneHost.tsx` (~+25/−10) prop decoupling; StageView updated.
- `ReceiverApp.tsx` (~+120) — SceneHost with TV profile + palette theme, apply
  `gainDb`, handle `scene` message, TrackShape from load payload.
- Sender: "tv scene" row in the casting idle stage (~60 LOC), shape shipping
  from `shapeCache` (~10).
- `lib/cast.ts` + tests (~+40).

## M-c (optional, ~1–2 days)

Receiver-side loudness measurement reported back to the sender's LRU;
casting-while-hosting (beat clock already abstracted); sender-reload session
re-adoption polish; "up next" toast on TV.

## Ranked risks / blockers

1. **Web Audio/analyser on real hardware** (the one true unknown; likely fine —
   same Chromium+MSE path as the sender). Mitigation: art mode needs no
   signal; plan-B PlayerManager tap; audio-on-TV ships regardless.
2. **Registration friction** (schedule): serial propagation delays, reboots.
   Mitigate: register day one, parallel with coding.
3. **Old-dongle CPU** (quality): TV profile; worst case pin to bars/art mode.
4. **CAF idle reaper** without PlayerManager: `disableIdleTimeout: true`;
   verify auto-close on sender disconnect on hardware.
5. **CSP**: verify sender SDK under strict-dynamic on prod; `/cast` matcher
   exclusion must not be forgotten (invisible black-screen failure).
6. **Expiry loops burning quota**: single-retry policy + existing five-failure
   stop.
7. **hls.js on 256MB-class devices**: `enableWorker: false` if needed;
   contingency `?prefer=progressive` nudge on the play route.

## Verification

- `bun test` — new `tests/cast.test.ts` plus existing suite;
  `bun run typecheck`.
- Playwright headless against `/cast?debug=1`: inject a load message (URL
  fetched via the authed dev session from `/api/tracks/[id]/play`), confirm
  playback, art stage, status beats in the debug console; M-b: all five scenes
  at the 30fps cap. Pause after test plays (quota + auto-advance).
- Sender in headless (no Cast SDK): button absent, zero regressions to local
  playback (play/seek/volume/advance smoke).
- **Hardware checklist (real TV + deployed build; record in ROADMAP on ship):**
  cast start mid-track at position; ended→advance→next-load chain; seek both
  directions; device volume; pause/resume from sender; cast end → local resume
  at parked position; stale-URL recovery; five-failure stop; TV-unplug
  disconnect handling; one full album hands-off. M-b adds: scene switching
  from sender, accent follows artwork, sustained fps eyeball, no memory creep
  over an album.
- Cannot be verified without hardware: analyser signal on device, real scene
  fps/thermals, discovery/handshake/message latency, idle-timeout semantics,
  CDN CORS from the Chromecast UA, device volume routing.
