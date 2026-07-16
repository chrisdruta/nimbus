import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import { cursorParam, withUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withUser(async (session) => {
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getPlaylists(accessToken, cursor);
    return { playlists: page.items, nextCursor: page.nextCursor };
  });
}
