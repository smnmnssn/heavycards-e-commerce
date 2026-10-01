import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE_PREFIX } from "@/lib/auth/policy";
import {
  ADMIN_PATH_HEADER,
  isPublicAdminPath,
  loginUrlFor,
} from "@/lib/auth/routes";

/**
 * Optimistic admin gate: requests without a session cookie are sent to the
 * login page before any admin page renders. This is a convenience, not the
 * security boundary. The cookie is not verified here; every admin page,
 * server action and route handler authorizes itself (src/lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicAdminPath(pathname)) return NextResponse.next();

  if (!getSessionCookie(request, { cookiePrefix: ADMIN_COOKIE_PREFIX })) {
    return NextResponse.redirect(
      new URL(loginUrlFor(`${pathname}${search}`), request.url),
    );
  }

  const headers = new Headers(request.headers);
  headers.set(ADMIN_PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
