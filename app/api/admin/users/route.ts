import { withAdmin } from "@/lib/route-helpers";
import { listUsersWithUsage } from "@/lib/db";
import { utcDayKey } from "@/lib/quota";
import { isOwner } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return withAdmin(async () => {
    const users = await listUsersWithUsage(utcDayKey());
    return users.map((u) => ({
      id: u.id,
      scUserId: u.sc_user_id,
      username: u.sc_username,
      permalink: u.sc_permalink,
      avatarUrl: u.avatar_url,
      disabled: u.disabled,
      createdAt: u.created_at.toISOString(),
      todayCount: u.today_count,
      isOwner: isOwner(u.sc_user_id),
    }));
  });
}
