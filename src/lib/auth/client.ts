import { createAuthClient } from "better-auth/client";

type AuthClient = ReturnType<typeof createAuthClient>;
let client: AuthClient | undefined;

/**
 * Browser client for the Better Auth endpoints (sign-in, password reset).
 * Requests go through `/api/auth`, where Better Auth applies rate limiting
 * and origin checks. Created on first use so it never runs during SSR.
 */
export function getAuthClient(): AuthClient {
  client ??= createAuthClient({
    baseURL: window.location.origin,
    basePath: "/api/auth",
  });
  return client;
}
