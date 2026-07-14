import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/route-helpers";
import { parseQueueTracks } from "@/lib/slipstream";
import { SHARED_QUEUE_CAP } from "@/lib/shared-queue";
import {
  getSession,
  startSession,
  stopSession,
} from "@/lib/shared-session-store";

export const runtime = "nodejs";

/** Start (or restart) the caller's shared session, seeded with their
 * current upcoming tracks. Metadata is validated like heartbeat windows —
 * it renders in every participant's DOM. */
export async function POST(req: NextRequest) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const body = await readJsonBody(req, 128 * 1024);
    const b = (body ?? {}) as Record<string, unknown>;
    const tracks = parseQueueTracks(b.queue ?? [], SHARED_QUEUE_CAP);
    if (!tracks) throw new BadRequestError("malformed seed queue");
    const entries = tracks.map((t) => ({ ...t, addedBy: null }));
    return startSession(session.userId, entries);
  });
}

/** Stop sharing. Idempotent — the row may already be self-healed away. */
export async function DELETE(req: NextRequest) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    await stopSession(session.userId);
    return { ok: true };
  });
}

/** The caller's own live session, if any — reload revival. */
export async function GET() {
  return withUser(async (session) => ({
    session: await getSession(session.userId),
  }));
}
