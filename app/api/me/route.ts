import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => {
    const { accessToken } = await getValidAccessToken(session.userId);
    return getProvider().getMe(accessToken);
  });
}
