import { randomBytes } from "node:crypto";
import { getPool, sql, type UpsertUserFields, type UserRow } from "./db";

const INVITE_TTL_DAYS = 7;

/** Code missing, already used, revoked, or expired — restart with a fresh link. */
export class InviteInvalidError extends Error {}

export interface InviteRow {
  id: number;
  code: string;
  note: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  used_at: Date | null;
  used_by: number | null;
  used_by_username: string | null;
}

export type InviteStatus = "active" | "used" | "revoked" | "expired";

/** Pure status derivation; precedence used > revoked > expired > active. */
export function inviteStatus(
  invite: Pick<InviteRow, "used_at" | "revoked_at" | "expires_at">,
  now: Date = new Date(),
): InviteStatus {
  if (invite.used_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** 22-char base64url token — unguessable, URL-safe. */
export function generateInviteCode(): string {
  return randomBytes(16).toString("base64url");
}

function toInviteRow(row: Record<string, unknown>): InviteRow {
  return {
    id: Number(row.id),
    code: String(row.code),
    note: (row.note as string) ?? null,
    created_at: new Date(row.created_at as string | Date),
    expires_at: new Date(row.expires_at as string | Date),
    revoked_at: row.revoked_at ? new Date(row.revoked_at as string | Date) : null,
    used_at: row.used_at ? new Date(row.used_at as string | Date) : null,
    used_by: row.used_by === null || row.used_by === undefined ? null : Number(row.used_by),
    used_by_username: (row.used_by_username as string) ?? null,
  };
}

export async function createInvite(note: string | null): Promise<InviteRow> {
  const rows = await sql()`
    INSERT INTO invites (code, note, expires_at)
    VALUES (${generateInviteCode()}, ${note},
            now() + make_interval(days => ${INVITE_TTL_DAYS}))
    RETURNING id, code, note, created_at, expires_at, revoked_at, used_at, used_by
  `;
  return toInviteRow(rows[0]);
}

export async function listInvites(): Promise<InviteRow[]> {
  const rows = await sql()`
    SELECT i.id, i.code, i.note, i.created_at, i.expires_at, i.revoked_at,
           i.used_at, i.used_by, u.sc_username AS used_by_username
    FROM invites i
    LEFT JOIN users u ON u.id = i.used_by
    ORDER BY i.created_at DESC
  `;
  return rows.map(toInviteRow);
}

/** Revokes an unused invite; returns false if it was already used/missing. */
export async function revokeInvite(id: number): Promise<boolean> {
  const rows = await sql()`
    UPDATE invites SET revoked_at = now()
    WHERE id = ${id} AND used_at IS NULL AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/** The invite iff it can still be claimed (drives the invite landing page). */
export async function getClaimableInvite(
  code: string,
): Promise<InviteRow | null> {
  const rows = await sql()`
    SELECT id, code, note, created_at, expires_at, revoked_at, used_at, used_by
    FROM invites WHERE code = ${code}
  `;
  if (!rows[0]) return null;
  const invite = toInviteRow(rows[0]);
  return inviteStatus(invite) === "active" ? invite : null;
}

/**
 * Atomically claim a single-use invite and create the member. Two racing
 * sign-ins on the same link serialize on the invite row lock: the winner's
 * UPDATE stamps used_at, the loser's matches zero rows and throws.
 */
export async function claimInviteAndCreateUser(
  code: string,
  fields: UpsertUserFields,
): Promise<UserRow> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `UPDATE invites SET used_at = now()
       WHERE code = $1 AND used_at IS NULL AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING id`,
      [code],
    );
    if (claim.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new InviteInvalidError("invite is no longer valid");
    }

    const { rows } = await client.query(
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
       RETURNING id, sc_user_id, sc_permalink, sc_username, avatar_url,
                 disabled, access_token_enc, refresh_token_enc,
                 access_expires_at`,
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
    const user = rows[0];

    await client.query(`UPDATE invites SET used_by = $1 WHERE id = $2`, [
      user.id,
      claim.rows[0].id,
    ]);
    await client.query("COMMIT");

    return {
      ...(user as UserRow),
      id: Number(user.id),
      sc_user_id: Number(user.sc_user_id),
      disabled: Boolean(user.disabled),
      access_expires_at: new Date(user.access_expires_at),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
