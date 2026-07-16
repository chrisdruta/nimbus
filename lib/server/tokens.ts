import "server-only";

import { getPool, getUserById } from "./db";
import { decryptToken, encryptToken, tokenContext } from "./crypto";
import { getProvider } from "../provider";

/** Refresh this early so a token can't expire mid-request. */
const SKEW_MS = 60_000;

/** Refresh token burned/revoked — the user must go through OAuth again. */
export class ReauthRequiredError extends Error {}

export interface ValidToken {
  accessToken: string;
  expiresAt: Date;
  refreshed: boolean;
}

function fresh(expiresAt: Date | string): boolean {
  return new Date(expiresAt).getTime() - Date.now() > SKEW_MS;
}

/**
 * Returns a usable access token, refreshing under a row lock when needed.
 * SoundCloud refresh tokens are single-use, so concurrent refreshes for the
 * same user must serialize: whoever wins the `FOR UPDATE` lock refreshes and
 * persists the rotated pair; waiters re-check expiry after acquiring the
 * lock and reuse the winner's result instead of burning the old token.
 */
export async function getValidAccessToken(
  userId: number,
  opts?: { force?: boolean },
): Promise<ValidToken> {
  const force = opts?.force ?? false;

  if (!force) {
    const row = await getUserById(userId);
    if (!row) throw new ReauthRequiredError("unknown user");
    if (fresh(row.access_expires_at)) {
      return {
        accessToken: decryptToken(
          row.access_token_enc,
          tokenContext(row.sc_user_id, "access"),
        ),
        expiresAt: new Date(row.access_expires_at),
        refreshed: false,
      };
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT sc_user_id, access_token_enc, refresh_token_enc, access_expires_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = rows[0];
    if (!row) throw new ReauthRequiredError("unknown user");

    // A concurrent request may have refreshed while we waited on the lock.
    if (!force && fresh(row.access_expires_at)) {
      await client.query("COMMIT");
      return {
        accessToken: decryptToken(
          row.access_token_enc,
          tokenContext(Number(row.sc_user_id), "access"),
        ),
        expiresAt: new Date(row.access_expires_at),
        refreshed: false,
      };
    }

    let tokens;
    try {
      tokens = await getProvider().refresh(
        decryptToken(
          row.refresh_token_enc,
          tokenContext(Number(row.sc_user_id), "refresh"),
        ),
      );
    } catch (cause) {
      throw new ReauthRequiredError(`token refresh failed: ${cause}`);
    }
    await client.query(
      `UPDATE users SET access_token_enc = $1, refresh_token_enc = $2,
         access_expires_at = $3, updated_at = now()
       WHERE id = $4`,
      [
        encryptToken(
          tokens.accessToken,
          tokenContext(Number(row.sc_user_id), "access"),
        ),
        encryptToken(
          tokens.refreshToken,
          tokenContext(Number(row.sc_user_id), "refresh"),
        ),
        tokens.expiresAt,
        userId,
      ],
    );
    await client.query("COMMIT");
    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      refreshed: true,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
