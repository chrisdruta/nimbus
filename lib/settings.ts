import { sql } from "./db";

export interface AppSettings {
  userDailyPlayLimit: number;
  globalDailyPlayLimit: number;
}

function toSettings(row: Record<string, unknown>): AppSettings {
  return {
    userDailyPlayLimit: Number(row.user_daily_play_limit),
    globalDailyPlayLimit: Number(row.global_daily_play_limit),
  };
}

// Read fresh every time — one ~5 ms Neon query per play at friends-scale,
// and admin changes take effect on the very next request.
export async function getSettings(): Promise<AppSettings> {
  const rows = await sql()`
    SELECT user_daily_play_limit, global_daily_play_limit
    FROM app_settings WHERE id = 1
  `;
  if (!rows[0]) throw new Error("app_settings row missing — apply db/schema.sql");
  return toSettings(rows[0]);
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const rows = await sql()`
    UPDATE app_settings SET
      user_daily_play_limit = COALESCE(${patch.userDailyPlayLimit ?? null}, user_daily_play_limit),
      global_daily_play_limit = COALESCE(${patch.globalDailyPlayLimit ?? null}, global_daily_play_limit),
      updated_at = now()
    WHERE id = 1
    RETURNING user_daily_play_limit, global_daily_play_limit
  `;
  return toSettings(rows[0]);
}
