import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  ConflictError,
  readJsonBody,
  requireSameOrigin,
  positiveSafeInteger,
} from "@/lib/route-helpers";
import { sql } from "@/lib/db";
import {
  addEntry,
  parseQueueOp,
  removeEntry,
  reorderEntries,
} from "@/lib/shared-queue";
import { mutateQueue } from "@/lib/shared-session-store";

export const runtime = "nodejs";

/**
 * Mutate a live shared session's queue: add / remove / reorder. Any member
 * may edit (invite-only trust at friends scale) — including the host, who
 * goes through the same row-locked path as everyone else. The response
 * carries the new truth so the actor updates immediately; everyone else
 * sees the revision bump on their next poll (≤5s).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withUser(async (session) => {
    requireSameOrigin(req);
    const hostId = positiveSafeInteger(userId, "user id");
    const op = parseQueueOp(await readJsonBody(req, 32 * 1024));
    if (!op) throw new BadRequestError("malformed queue op");

    if (op.op === "add") {
      // Stamp who queued it (display-only) and reject re-adding what's
      // already playing. The current-track read precedes the row lock; if
      // the host advances in between, the next shared beat's prune
      // self-heals the stray entry.
      const rows = await sql()`
        SELECT u.sc_username, s.track_id
        FROM users u
        LEFT JOIN slipstreams s ON s.user_id = ${hostId}
        WHERE u.id = ${session.userId}
      `;
      const addedBy = (rows[0]?.sc_username as string | null) ?? null;
      const currentTrackId =
        rows[0]?.track_id != null ? Number(rows[0].track_id) : null;
      return mutateQueue(hostId, (queue) => {
        const res = addEntry(queue, { ...op.track, addedBy }, currentTrackId);
        if ("error" in res) {
          throw new BadRequestError(
            res.error === "duplicate" ? "already queued" : "queue full",
          );
        }
        return res.queue;
      });
    }

    if (op.op === "remove") {
      return mutateQueue(hostId, (queue) => {
        const res = removeEntry(queue, op.trackId);
        return res.changed ? res.queue : null;
      });
    }

    // reorder — revision-checked inside the lock so simultaneous reorders
    // can't silently clobber each other; the loser refreshes and retries.
    return mutateQueue(hostId, (queue, revision) => {
      if (revision !== op.expectedRevision) {
        throw new ConflictError("queue changed");
      }
      const next = reorderEntries(queue, op.order);
      if (next === null) throw new BadRequestError("not a permutation");
      return next;
    });
  });
}
