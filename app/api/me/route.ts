import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";
import { isOwner } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => {
    const { accessToken } = await getValidAccessToken(session.userId);
    const me = await getProvider().getMe(accessToken);
    return { ...me, isOwner: isOwner(session.scUserId) };
  });
}
