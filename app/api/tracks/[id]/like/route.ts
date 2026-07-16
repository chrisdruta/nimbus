import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import {
  positiveSafeInteger,
  requireSameOrigin,
  withUser,
} from "@/lib/server/route-helpers";

export const runtime = "nodejs";

function setLiked(
  req: NextRequest,
  params: Promise<{ id: string }>,
  liked: boolean,
) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const trackId = positiveSafeInteger((await params).id, "track id");
    const { accessToken } = await getValidAccessToken(session.userId);
    await getProvider().setTrackLiked(accessToken, trackId, liked);
    return { liked };
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return setLiked(req, params, true);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return setLiked(req, params, false);
}
