import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import {
  positiveSafeInteger,
  requireSameOrigin,
  withUser,
} from "@/lib/route-helpers";
import { consumePlayStart } from "@/lib/quota";
import { recordTrackPlay } from "@/lib/plays";
import { isOwner } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    requireSameOrigin(req);
    const trackId = positiveSafeInteger(id, "track id");

    // Every resolution attempt counts. This deliberately avoids an invalid
    // track/refund loop becoming an unlimited SoundCloud request oracle.
    await consumePlayStart(session.userId, isOwner(session.scUserId));

    const { accessToken } = await getValidAccessToken(session.userId);
    const stream = await getProvider().resolveStream(accessToken, trackId);
    await recordTrackPlay(session.userId, trackId).catch(() => {});
    return stream;
  });
}
