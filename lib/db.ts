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
  sc_username: string | null;
  avatar_url: string | null;
  disabled: boolean;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: Date;
}

// Postgres bigint arrives as a string; both ids fit in a JS number.
function toUserRow(row: Record<string, unknown>): UserRow {
  return {
    ...(row as unknown as UserRow),
    id: Number(row.id),
    sc_user_id: Number(row.sc_user_id),
    access_expires_at: new Date(row.access_expires_at as string | Date),
  };
}

const USER_COLUMNS = `id, sc_user_id, sc_permalink, sc_username, avatar_url,
  disabled, access_token_enc, refresh_token_enc, access_expires_at`;

export async function getUserById(id: number): Promise<UserRow | null> {
  const rows = await sql().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? toUserRow(rows[0]) : null;
}

export async function getUserByScId(scUserId: number): Promise<UserRow | null> {
  const rows = await sql().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE sc_user_id = $1`,
    [scUserId],
  );
  return rows[0] ? toUserRow(rows[0]) : null;
}

export interface UpsertUserFields {
  scUserId: number;
  scPermalink: string | null;
  scUsername: string | null;
  avatarUrl: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
}

export async function upsertUser(fields: UpsertUserFields): Promise<UserRow> {
  const rows = await sql().query(
    `INSERT INTO users (sc_user_id, sc_permalink, sc_username, avatar_url,
                        access_token_enc, refresh_token_enc, access_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sc_user_id) DO UPDATE SET
       sc_permalink = EXCLUDED.sc_permalink,
       sc_username = EXCLUDED.sc_username,
       avatar_url = EXCLUDED.avatar_url,
       access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       access_expires_at = EXCLUDED.access_expires_at,
       updated_at = now()
     RETURNING ${USER_COLUMNS}`,
    [
      fields.scUserId,
      fields.scPermalink,
      fields.scUsername,
      fields.avatarUrl,
      fields.accessTokenEnc,
      fields.refreshTokenEnc,
      fields.accessExpiresAt,
    ],
  );
  return toUserRow(rows[0]);
}

/**
 * Refresh the cached profile columns (shown by admin and slipstream) from a
 * live provider fetch. Tokens are untouched; rotation owns those.
 */
export async function updateUserProfile(
  id: number,
  fields: {
    scPermalink: string | null;
    scUsername: string | null;
    avatarUrl: string | null;
  },
): Promise<void> {
  await sql()`
    UPDATE users
    SET sc_permalink = ${fields.scPermalink},
        sc_username = ${fields.scUsername},
        avatar_url = ${fields.avatarUrl},
        updated_at = now()
    WHERE id = ${id}
  `;
}

/** Slim membership check run on every authed request. */
export async function getUserAuth(
  id: number,
): Promise<{ id: number; scUserId: number; disabled: boolean } | null> {
  const rows =
    await sql()`SELECT id, sc_user_id, disabled FROM users WHERE id = ${id}`;
  return rows[0]
    ? {
        id: Number(rows[0].id),
        scUserId: Number(rows[0].sc_user_id),
        disabled: Boolean(rows[0].disabled),
      }
    : null;
}

export interface UserWithUsage {
  id: number;
  sc_user_id: number;
  sc_permalink: string | null;
  sc_username: string | null;
  avatar_url: string | null;
  disabled: boolean;
  created_at: Date;
  today_count: number;
}

export async function listUsersWithUsage(
  day: string,
): Promise<UserWithUsage[]> {
  const rows = await sql()`
    SELECT u.id, u.sc_user_id, u.sc_permalink, u.sc_username, u.avatar_url,
           u.disabled, u.created_at, COALESCE(pc.count, 0) AS today_count
    FROM users u
    LEFT JOIN play_counts pc ON pc.user_id = u.id AND pc.day = ${day}::date
    ORDER BY u.created_at
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    sc_user_id: Number(row.sc_user_id),
    sc_permalink: (row.sc_permalink as string) ?? null,
    sc_username: (row.sc_username as string) ?? null,
    avatar_url: (row.avatar_url as string) ?? null,
    disabled: Boolean(row.disabled),
    created_at: new Date(row.created_at as string | Date),
    today_count: Number(row.today_count),
  }));
}

export async function setUserDisabled(
  id: number,
  disabled: boolean,
): Promise<void> {
  await sql()`
    UPDATE users SET disabled = ${disabled}, updated_at = now()
    WHERE id = ${id}
  `;
}

/** Removes the user, their encrypted tokens, and (via cascade) play counts. */
export async function deleteUser(id: number): Promise<void> {
  await sql()`DELETE FROM users WHERE id = ${id}`;
}
