import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  NotFoundError,
  positiveSafeInteger,
} from "@/lib/route-helpers";
import { getSlipstream } from "@/lib/slipstream-store";

export const runtime = "nodejs";

/** Follower snapshot poll. Timestamps are ms-epoch numbers on the DB clock
 * so the pure sync engine (lib/slipstream.ts) consumes them directly. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withUser(async (session) => {
    const hostId = positiveSafeInteger(userId, "user id");
    if (hostId === session.userId) {
      throw new BadRequestError("that's your own slipstream");
    }
    // Stale ≡ ended ≡ missing — followers never distinguish.
    const snap = await getSlipstream(hostId);
    if (!snap) throw new NotFoundError("not live");
    return snap;
  });
}
