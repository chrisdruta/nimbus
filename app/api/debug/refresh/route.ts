import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

/** Spike goal 7: force a refresh-token rotation on demand. Never returns
 * token material — only timing metadata. */
export async function POST() {
  return withUser(async (session) => {
    const { expiresAt, refreshed } = await getValidAccessToken(
      session.userId,
      { force: true },
    );
    return {
      refreshed,
      refreshedAt: new Date().toISOString(),
      newExpiry: expiresAt.toISOString(),
    };
  });
}
