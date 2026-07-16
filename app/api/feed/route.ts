import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import { cursorParam, withUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

// Discovery only — no quota; play starts are the sole quota consumer.
export async function GET(req: NextRequest) {
  return withUser(async (session) => {
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getFeedPage(accessToken, cursor);
    return { items: page.items, nextCursor: page.nextCursor };
  });
}
