import { NextResponse, type NextRequest } from "next/server";

// Per-request nonce CSP. Next reads the nonce from the *request*
// Content-Security-Policy header and stamps it on every framework <script>;
// the response copy is what the browser enforces. The app itself has no
// inline scripts — if a next/script <Script> is ever added, forward the nonce
// via an `x-nonce` request header and read it with headers() where needed.
// All other security headers stay in next.config.ts.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString("base64");

  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // 'strict-dynamic' propagates nonce trust to the chunk <script>s the
    // bootstrap appends; 'self' remains only as a CSP2 fallback. React dev
    // mode needs eval() for debugging features; production never gets it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    // next/font inlines a <style>; dropping this is its own roadmap item.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.sndcdn.com",
    "media-src 'self' blob: https://*.sndcdn.com https://*.soundcloud.cloud",
    "connect-src 'self' https://*.sndcdn.com https://*.soundcloud.cloud",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      // HTML documents only: API routes never render one, and prefetches
      // execute in the context of an already-nonced page.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
