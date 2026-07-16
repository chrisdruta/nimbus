import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import { withUser } from "@/lib/server/route-helpers";
import { isOwner } from "@/lib/server/session";
import { updateUserProfile } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => {
    const { accessToken } = await getValidAccessToken(session.userId);
    const me = await getProvider().getMe(accessToken);
    // Keep the DB's cached profile columns (admin, slipstream) in sync with
    // the live profile; outside the OAuth callback nothing else writes them.
    updateUserProfile(session.userId, {
      scPermalink: me.permalinkUrl,
      scUsername: me.username,
      avatarUrl: me.avatarUrl,
    }).catch(() => {});
    return { ...me, isOwner: isOwner(session.scUserId) };
  });
}
