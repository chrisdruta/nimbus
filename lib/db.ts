import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Node runtime (not edge) lacks a global WebSocket for the Pool transport.
neonConfig.webSocketConstructor = ws;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** One-shot queries over HTTP — cheapest path for single statements. */
export function sql() {
  return neon(databaseUrl());
}

/**
 * WebSocket pool for multi-statement transactions (the locked token
 * refresh). Callers must release the client and may hold the pool across
 * invocations in dev; serverless instances are short-lived anyway.
 */
let pool: Pool | undefined;
export function getPool(): Pool {
  pool ??= new Pool({ connectionString: databaseUrl() });
  return pool;
}

export interface UserRow {
  id: number;
  sc_user_id: number;
  sc_permalink: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: Date;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const rows = await sql()`
    SELECT id, sc_user_id, sc_permalink, access_token_enc, refresh_token_enc,
           access_expires_at
    FROM users WHERE id = ${id}
  `;
  return (rows[0] as UserRow | undefined) ?? null;
}

export async function upsertUser(fields: {
  scUserId: number;
  scPermalink: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
}): Promise<UserRow> {
  const rows = await sql()`
    INSERT INTO users (sc_user_id, sc_permalink, access_token_enc,
                       refresh_token_enc, access_expires_at)
    VALUES (${fields.scUserId}, ${fields.scPermalink}, ${fields.accessTokenEnc},
            ${fields.refreshTokenEnc}, ${fields.accessExpiresAt})
    ON CONFLICT (sc_user_id) DO UPDATE SET
      sc_permalink = EXCLUDED.sc_permalink,
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      access_expires_at = EXCLUDED.access_expires_at,
      updated_at = now()
    RETURNING id, sc_user_id, sc_permalink, access_token_enc,
              refresh_token_enc, access_expires_at
  `;
  return rows[0] as UserRow;
}
