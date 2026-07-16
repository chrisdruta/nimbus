-- Nimbus schema — idempotent desired state. Re-apply after pulling:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sc_user_id        bigint UNIQUE NOT NULL,
  sc_permalink      text,
  access_token_enc  text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS sc_username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled    boolean NOT NULL DEFAULT false;
-- Hides plain listening presence from the feed; explicitly shared sessions
-- still publish (sharing is its own deliberate act).
ALTER TABLE users ADD COLUMN IF NOT EXISTS private_listening boolean NOT NULL DEFAULT false;

-- Single-use invite links. Codes are bearer credentials, so only their
-- SHA-256 digest is stored — the link is shown once at creation and cannot
-- be recovered; a read-only DB leak exposes no usable invites.
CREATE TABLE IF NOT EXISTS invites (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_hash  text UNIQUE NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  used_at    timestamptz,
  used_by    bigint REFERENCES users(id) ON DELETE SET NULL
);

-- Migration for databases predating code_hash: hash the plaintext codes in
-- place (PG built-in sha256() matches Node's hex digest), then drop the
-- plaintext column. The DO block only runs while the legacy column exists,
-- so re-applying this file stays idempotent. Deliberate exception to the
-- additive-only convention: removing the recoverable secret is the point.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS code_hash text UNIQUE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'invites' AND column_name = 'code') THEN
    UPDATE invites
      SET code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex')
      WHERE code_hash IS NULL;
    ALTER TABLE invites DROP COLUMN code;
    ALTER TABLE invites ALTER COLUMN code_hash SET NOT NULL;
  END IF;
END $$;

-- Stream-resolution attempts per user per UTC day. Failed/unavailable tracks
-- count too, preventing unlimited provider calls through refund loops.
-- Global usage for a day is SUM(count) —
-- a single global counter row would serialize every play in the app.
CREATE TABLE IF NOT EXISTS play_counts (
  user_id bigint  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date    NOT NULL,
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS play_counts_day_idx ON play_counts (day);

-- Per-track lifetime play tallies (rediscovery shuffle weighting, future
-- "recently played"). One row per (user, track) — bounded by what the
-- user has actually played, unlike an event log.
CREATE TABLE IF NOT EXISTS track_plays (
  user_id         bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id        bigint      NOT NULL,
  play_count      integer     NOT NULL DEFAULT 1,
  first_played_at timestamptz NOT NULL DEFAULT now(),
  last_played_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX IF NOT EXISTS track_plays_recent_idx
  ON track_plays (user_id, last_played_at DESC);

-- Live listening presence ("slipstream"): one row per host, upserted by
-- heartbeat while playing; a host is live while updated_at is fresh
-- (STALE_MS in lib/slipstream.ts — keep the two in lockstep). Rows are never
-- cleaned up: staleness is a WHERE clause and cardinality = user count.
-- track_window is a wholesale-replaced jsonb snapshot (QueueTrack[], current
-- track first) — display metadata only, never stream URLs; followers resolve
-- streams via their own token and quota. ("window" itself is reserved SQL.)
CREATE TABLE IF NOT EXISTS slipstreams (
  user_id      bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  track_id     bigint  NOT NULL,
  position_ms  integer NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  playing      boolean NOT NULL DEFAULT true,
  track_window jsonb   NOT NULL DEFAULT '[]',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slipstreams_live_idx
  ON slipstreams (updated_at DESC) WHERE playing;

-- Shared slipstream sessions: one row per host, created by an explicit
-- "share session" action. queue is the agreed upcoming list
-- (SharedQueueEntry[] jsonb — display metadata only; every participant
-- resolves streams via their own token and quota). revision increments on
-- every queue change so pollers skip unchanged payloads. control is a
-- one-slot last-writer-wins transport intent ({"type":"play","trackId":N}
-- | {"type":"prev"}) guarded by control_seq; the host applies it — the
-- host's audio element stays the only clock. A session is live only while
-- the host's slipstreams presence is fresh, and any plain (non-shared)
-- heartbeat from the host deletes the row, so stale sessions self-heal.
-- Cardinality = user count; no cleanup job.
CREATE TABLE IF NOT EXISTS slipstream_sessions (
  host_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  queue       jsonb  NOT NULL DEFAULT '[]',
  revision    bigint NOT NULL DEFAULT 1,
  control     jsonb,
  control_seq bigint NOT NULL DEFAULT 0,
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row of app-wide knobs. The global limit stays under SoundCloud's
-- 15,000 stream-starts/day client cap to leave concurrency headroom.
CREATE TABLE IF NOT EXISTS app_settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_daily_play_limit   integer NOT NULL DEFAULT 150 CHECK (user_daily_play_limit >= 0),
  global_daily_play_limit integer NOT NULL DEFAULT 12000 CHECK (global_daily_play_limit >= 0),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
