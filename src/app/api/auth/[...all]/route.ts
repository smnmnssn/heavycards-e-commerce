import { toNextJsHandler } from "better-auth/next-js";

import { ALLOWED_AUTH_ENDPOINTS } from "@/lib/auth/policy";
import { auth } from "@/lib/auth/server";

const handlers = toNextJsHandler(auth);
const AUTH_BASE_PATH = "/api/auth";
const allowed = new Set<string>(ALLOWED_AUTH_ENDPOINTS);

/**
 * Only the endpoints the admin UI uses are reachable. Sign-up, profile and
 * account endpoints answer 404 before Better Auth sees the request, so they
 * cannot create administrators or change role/isActive.
 */
function isAllowed(request: Request): boolean {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  return allowed.has(pathname.slice(AUTH_BASE_PATH.length));
}

const notFound = () =>
  new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(request: Request) {
  return isAllowed(request) ? handlers.GET(request) : notFound();
}

export async function POST(request: Request) {
  return isAllowed(request) ? handlers.POST(request) : notFound();
}
