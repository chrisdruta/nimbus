import { type NextRequest } from "next/server";
import { withAdmin, BadRequestError } from "@/lib/route-helpers";
import { revokeInvite } from "@/lib/invites";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withAdmin(async () => {
    const inviteId = Number(id);
    if (!Number.isInteger(inviteId)) {
      throw new BadRequestError(`bad invite id: ${id}`);
    }
    const revoked = await revokeInvite(inviteId);
    if (!revoked) {
      throw new BadRequestError("invite is already used, revoked, or missing");
    }
    return { id: inviteId, revoked: true };
  });
}
