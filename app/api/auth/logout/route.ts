import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/server/session";
import { errorResponse, requireSameOrigin } from "@/lib/server/route-helpers";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(req);
    await clearSession();
    const response = NextResponse.redirect(
      new URL("/", process.env.APP_URL),
      303,
    );
    // Queue/library metadata can expose private listening history on a shared
    // browser. Disconnect means this origin forgets the local account too.
    response.headers.set("Clear-Site-Data", '"cache", "storage"');
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
