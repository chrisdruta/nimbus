import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    const trackId = Number(id);
    if (!Number.isInteger(trackId)) throw new Error(`bad track id: ${id}`);
    const { accessToken } = await getValidAccessToken(session.userId);
    // JSON with a short-lived CDN URL — the audio itself never crosses
    // this backend.
    return getProvider().resolveStream(accessToken, trackId);
  });
}
