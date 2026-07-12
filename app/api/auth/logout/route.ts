import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  await clearSession();
  return NextResponse.redirect(new URL("/", process.env.APP_URL), 303);
}
