import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  NotFoundError,
  positiveSafeInteger,
} from "@/lib/server/route-helpers";
import { getSlipstream } from "@/lib/server/slipstream-store";
import { mintSharedCapability } from "@/lib/server/shared-capability";

export const runtime = "nodejs";

/** Follower snapshot poll. Timestamps are ms-epoch numbers on the DB clock
 * so the pure sync engine (lib/slipstream.ts) consumes them directly.
 * `?rev=N` is the follower's last-seen shared-queue revision: the queue is
 * embedded in `shared` only when the revision moved — same poll, no extra
 * requests, small payloads while nothing changes. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withUser(async (session) => {
    const hostId = positiveSafeInteger(userId, "user id");
    if (hostId === session.userId) {
      throw new BadRequestError("that's your own slipstream");
    }
    const revParam = req.nextUrl.searchParams.get("rev");
    let rev: number | null = null;
    if (revParam !== null) {
      rev = Number(revParam);
      if (!Number.isSafeInteger(rev) || rev < 0) {
        throw new BadRequestError("bad rev");
      }
    }
    // Stale ≡ ended ≡ missing — followers never distinguish.
    const snap = await getSlipstream(hostId);
    if (!snap) throw new NotFoundError("not live");
    const { shared, ...rest } = snap;
    return {
      ...rest,
      shared: shared
        ? {
            revision: shared.revision,
            controlSeq: shared.controlSeq,
            capability: mintSharedCapability({
              userId: session.userId,
              hostId,
              sessionId: shared.sessionId,
            }),
            ...(shared.revision !== rev ? { queue: shared.queue } : {}),
          }
        : null,
    };
  });
}
