# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@.devcontainer/AGENTS.md

## Commands

```
bun install                     # deps
bun run dev                     # dev server on :3000
bun run build                   # production build
bun run typecheck               # tsc --noEmit
bun test                        # all unit tests
bun test tests/queue.test.ts    # one file
bun test -t "gravity"           # tests matching a name
psql "$DATABASE_URL" -f db/schema.sql   # apply schema (idempotent — safe to re-apply)
```

Secrets live in `.env` (gitignored; see `.env.example`). The dev server must be
launched with the env sourced: `set -a && . ./.env && set +a && bun run dev`.
Everything builds and tests without credentials. (The 2020 CRA predecessor was
removed from the tree; it lives in git history before the M4 cleanup.)

### Visual testing (playwright-cli)

`bunx playwright-cli` drives a headless Chromium against the dev server — use
it to look at pages you change (the `.claude/skills/playwright-cli` skill has
the full command reference). Config is `.playwright/cli.config.json`
(chromium, not branded chrome — that's the only one installed).

```
bunx playwright-cli open http://localhost:3000
bunx playwright-cli snapshot                    # a11y tree with element refs
bunx playwright-cli screenshot --filename <scratchpad>/x.png   # then Read the png
bunx playwright-cli close
```

- Screenshots and artifacts go to the scratchpad, never the repo
  (`.playwright/` and `.playwright-cli/` are gitignored except the config).
- Authed pages: `set -a && . ./.env && set +a && bun tools/mint-session.ts`
  prints a session JWT for the owner; set it with
  `bunx playwright-cli cookie-set nimbus_session <jwt>` after opening the app
  origin, then reload.
- Don't loop track playback in automation — play resolution consumes real
  SoundCloud quota (`consumePlayStart`).

## Design north star

"An unofficial, lightweight SoundCloud client — aesthetic features for an
aesthetic listening experience." Player-first, lowercase, understated chrome;
borrow good patterns from anywhere but don't imitate any one app. Taste-check
every UI decision against this line.

## Architecture

**Token-broker pattern (hard constraint).** The Next.js backend brokers JSON
only: it holds OAuth secrets, resolves stream URLs by following SoundCloud's
authorized 302 to the signed CDN URL, and hands that URL to the browser. Audio
flows browser → CDN directly. Never proxy, cache, or store audio through the
backend, and never let a token, code verifier, or client secret reach the
browser (session/dance cookies are the only client-side state).

**Provider seam.** All SoundCloud request/response shapes live in
`lib/soundcloud/`; everything else consumes the normalized `MusicProvider`
interface and types from `lib/provider.ts`. UI and API routes must never
depend on raw provider responses — this seam is what makes a future provider
swap an env-var-and-one-directory change.

**Auth model.** OAuth 2.1 + PKCE; PKCE state (and any invite code) rides the
signed, short-lived `nimbus_oauth` cookie — never the SoundCloud redirect.
Sessions are 7-day jose JWTs, but `requireUser()` (`lib/session.ts`) is
DB-backed per request so disabling/removing a user cuts them off on their next
call. `OWNER_SC_USER_ID` identifies the owner/admin (there is no role column);
membership otherwise comes from single-use invites claimed atomically under a
row lock (`lib/invites.ts`). API routes wrap handlers in `withUser`/`withAdmin`
(`lib/route-helpers.ts`), which own the error→status vocabulary (401/403/400/
422/429); throw the typed errors, don't hand-roll responses.

**Tokens at rest.** AES-256-GCM blobs in Neon (`lib/crypto.ts`). SoundCloud
refresh tokens are single-use, so rotation serializes under a `FOR UPDATE`
row lock in `lib/tokens.ts` — copy that transaction pattern (via `getPool()`)
for any multi-statement write; use the `sql()` Neon HTTP one-shot for
everything else. No ORM; Postgres bigints arrive as strings — `Number()` them
at the row-mapping boundary.

**Quotas.** `/api/tracks/[id]/play` calls `consumePlayStart` *before* the
provider (one atomic INSERT…ON CONFLICT statement in `lib/quota.ts`) and
refunds on failure, so an over-cap user never consumes real SoundCloud budget
and failed resolutions don't drain quota. The per-user guard is exact; the
global guard is deliberately approximate under concurrency — the headroom
between `app_settings.global_daily_play_limit` (default 12,000) and
SoundCloud's 15,000/day client cap absorbs it. Do not "fix" this with a global
lock row. `track_plays` tallies are recorded only after a successful
resolution, best-effort (`.catch(() => {})`).

**Pure engines convention.** Domain logic lives in `lib/` as pure,
deterministic, unit-tested functions; React/DOM stays in `components/`. The
queue engine (`lib/queue.ts`) never sees artist strings or play counts — the
player injects lookups via `ShuffleContext`, and every shuffle mode degrades
gracefully when context is missing. Randomness is seeded (mulberry32) so tests
fix seeds. The viz layer follows the same split: DSP/onset/physics in
`lib/viz/` (tested), canvas painting in `components/viz/scenes/` (untested by
convention). Tests are `bun test`, pure functions only — no API-route or DB
tests; DB write paths are covered by the README validation checklists instead.

**Visualization system.** Scenes implement the `Scene` interface from
`lib/viz/scene.ts` and register in `components/viz/scenes/index.ts`;
`SceneHost` owns the canvas, rAF loop, DPR resize, visibility pause, and
reduced-motion handling. Each consumer owns a `FrameAnalyzer` (independent
DSP state). The audio graph in `PlayerProvider.ensureGraph()` is built once
per app lifetime — a media element accepts exactly one MediaElementSourceNode,
ever; change analyser config there, never topology. The bar smoothing in
`lib/viz/dsp.ts` is adapted from cava (MIT, attributed) — keep the attribution
header.

**Client conventions.** `PlayerProvider` owns queue state, the persistent
`<audio>` element, and the track-metadata cache (`metaRef`); state/actions/refs
are separate contexts. Components fetch API routes with plain `fetch` on mount
and refetch after mutations — no data library, no UI component library
(popovers/menus are hand-rolled). Tailwind v4 design tokens are CSS variables
in `app/globals.css` (`--color-accent` #ff4200 etc.); lowercase, understated
chrome is the house style. localStorage uses versioned/validated payloads
(`lib/queue.ts` persistence, `lib/prefs.ts`) with backfill for missing fields.

**Infra is settled.** Neon + polling is the chosen stack and slipstream
transport at friends scale (decision + revisit triggers in
`docs/ROADMAP.md` "Infrastructure"). Don't introduce realtime infra
(WebSockets/SSE/Redis/brokers) or new stores without hitting a trigger;
the Vercel Hobby quota to watch is Active CPU.

**Feature tracking.** `docs/ROADMAP.md` is the living tracker: planned work
under "Next / ideas", shipped milestones with dates and validation records
under "Shipped". Update it when a milestone ships; keep the README a clean
front page (features in present tense, no per-milestone history).

**Schema changes.** `db/schema.sql` is an idempotent desired-state file
(`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) —
extend it additively; verify it applies cleanly twice against a DB holding
real data.

## Constraints

- Free, personal, non-commercial; invite-only at friends scale. Tracks always
  credit and link back to their creator and SoundCloud.
- Credentials are env-vars only and must stay trivially replaceable — assume
  they can be revoked at any time. Only ever use credentials Chris registered
  himself (never a borrowed/scraped client id, including the one in the old
  CRA app in git history).
- The SoundCloud app console holds exactly ONE redirect URI (production).
  Local dev reuses the owner's Neon-stored tokens plus a minted session
  instead of re-running OAuth.
