import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import {
  positiveSafeInteger,
  requireSameOrigin,
  withUser,
} from "@/lib/route-helpers";

export const runtime = "nodejs";

function setFollowed(
  req: NextRequest,
  params: Promise<{ id: string }>,
  followed: boolean,
) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const artistId = positiveSafeInteger((await params).id, "artist id");
    const { accessToken } = await getValidAccessToken(session.userId);
    await getProvider().setArtistFollowed(accessToken, artistId, followed);
    return { followed };
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return setFollowed(req, params, true);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return setFollowed(req, params, false);
}
