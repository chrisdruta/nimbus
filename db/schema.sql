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

-- Single-use invite links. Codes are stored in the clear so the admin UI can
-- re-copy an active link; a leaked code only grants entry to this app.
CREATE TABLE IF NOT EXISTS invites (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text UNIQUE NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  used_at    timestamptz,
  used_by    bigint REFERENCES users(id) ON DELETE SET NULL
);

-- Stream starts per user per UTC day. Global usage for a day is SUM(count) —
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

-- One row of app-wide knobs. The global limit stays under SoundCloud's
-- 15,000 stream-starts/day client cap to leave concurrency headroom.
CREATE TABLE IF NOT EXISTS app_settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_daily_play_limit   integer NOT NULL DEFAULT 150 CHECK (user_daily_play_limit >= 0),
  global_daily_play_limit integer NOT NULL DEFAULT 12000 CHECK (global_daily_play_limit >= 0),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
