import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  return withUser(async (session) => {
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getPlaylists(accessToken, cursor);
    return { playlists: page.items, nextCursor: page.nextCursor };
  });
}
