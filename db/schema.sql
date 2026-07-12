-- Nimbus spike schema. Apply once: psql "$DATABASE_URL" -f db/schema.sql

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
