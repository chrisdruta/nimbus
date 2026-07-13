import { type NextRequest } from "next/server";
import {
  withAdmin,
  BadRequestError,
  positiveSafeInteger,
  requireSameOrigin,
} from "@/lib/route-helpers";
import { revokeInvite } from "@/lib/invites";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withAdmin(async () => {
    requireSameOrigin(req);
    const inviteId = positiveSafeInteger(id, "invite id");
    const revoked = await revokeInvite(inviteId);
    if (!revoked) {
      throw new BadRequestError("invite is already used, revoked, or missing");
    }
    return { id: inviteId, revoked: true };
  });
}
