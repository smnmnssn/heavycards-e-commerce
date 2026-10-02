import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE_PREFIX } from "@/lib/auth/policy";
import {
  ADMIN_PATH_HEADER,
  isPublicAdminPath,
  loginUrlFor,
} from "@/lib/auth/routes";
import {
  contentSecurityPolicy,
  createCspNonce,
} from "@/lib/security/content-security-policy";

const CSP_HEADER = "Content-Security-Policy";

/**
 * Admin requests only (see `config.matcher`):
 *
 * 1. Optimistic gate: requests without a session cookie are sent to the
 *    login page before any admin page renders. This is a convenience, not
 *    the security boundary. The cookie is not verified here; every admin
 *    page, server action and route handler authorizes itself
 *    (src/lib/auth/session.ts).
 * 2. A nonce-based Content-Security-Policy for every admin page (Milestone
 *    14). Next.js reads the nonce from the request's CSP header and applies
 *    it to its own scripts; admin pages always render per request
 *    (src/app/admin/layout.tsx), so each response gets a fresh nonce.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !isPublicAdminPath(pathname) &&
    !getSessionCookie(request, { cookiePrefix: ADMIN_COOKIE_PREFIX })
  ) {
    return NextResponse.redirect(
      new URL(loginUrlFor(`${pathname}${search}`), request.url),
    );
  }

  const policy = contentSecurityPolicy({
    development: process.env.NODE_ENV === "development",
    nonce: createCspNonce(),
  });
  const headers = new Headers(request.headers);
  headers.set(CSP_HEADER, policy);
  headers.set(ADMIN_PATH_HEADER, `${pathname}${search}`);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
