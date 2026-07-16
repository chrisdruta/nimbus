import { consumeProviderLimit } from "@/lib/server/rate-limit";
import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import { BadRequestError, cursorParam, withUser } from "@/lib/server/route-helpers";
import { normalizeSearchQuery } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withUser(async (session) => {
    consumeProviderLimit(session.userId);
    const q = normalizeSearchQuery(req.nextUrl.searchParams.get("q") ?? "");
    if (!q) throw new BadRequestError("missing search query");
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().searchTracks(accessToken, q, cursor);
    return { tracks: page.items, nextCursor: page.nextCursor };
  });
}
