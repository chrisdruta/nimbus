import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { BadRequestError, cursorParam, withUser } from "@/lib/route-helpers";
import { normalizeSearchQuery } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withUser(async (session) => {
    const q = normalizeSearchQuery(req.nextUrl.searchParams.get("q") ?? "");
    if (!q) throw new BadRequestError("missing search query");
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().searchArtists(accessToken, q, cursor);
    return { artists: page.items, nextCursor: page.nextCursor };
  });
}
