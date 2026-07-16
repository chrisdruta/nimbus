import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
  positiveSafeInteger,
} from "@/lib/server/route-helpers";
import { parseControl } from "@/lib/shared-queue";
import { writeControl } from "@/lib/server/shared-session-store";
import { verifySharedCapability } from "@/lib/server/shared-capability";
import { ForbiddenError } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Transport intent (next/prev/jump) from a shared-session member. One
 * last-writer-wins slot: "play" names an explicit target so concurrent
 * skips coalesce to the same track. The host applies it on its next beat
 * (≤5s) — only the host's audio element advances playback.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withUser(async (session) => {
    requireSameOrigin(req);
    const hostId = positiveSafeInteger(userId, "user id");
    if (hostId === session.userId) {
      // The host mutates its own queue locally, never via intents.
      throw new BadRequestError("that's your own session");
    }
    const capability = verifySharedCapability(
      req.headers.get("x-nimbus-shared-capability") ?? "",
      session.userId,
      hostId,
    );
    if (!capability) throw new ForbiddenError("not joined to this session");
    const control = parseControl(await readJsonBody(req, 4 * 1024));
    if (!control) throw new BadRequestError("malformed control");
    return {
      controlSeq: await writeControl(hostId, capability.sessionId, control),
    };
  });
}
