import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { createAuth, type PasswordResetRequest } from "@/lib/auth/config";

/**
 * Helpers for running the real Better Auth configuration against the test
 * database. Passwords are random per run; no credential lives in source.
 */

export const TEST_BASE_URL = "http://localhost:3000";
// Signs cookies in the throwaway test database only.
const TEST_AUTH_SECRET = randomBytes(32).toString("base64");

export const randomPassword = () =>
  `pw-${randomBytes(12).toString("base64url")}`;

export function createTestAuth(
  db: PrismaClient,
  { baseURL = TEST_BASE_URL }: { baseURL?: string } = {},
) {
  const resets: PasswordResetRequest[] = [];
  const auth = createAuth({
    db,
    baseURL,
    secret: TEST_AUTH_SECRET,
    sendPasswordReset: async (request) => {
      resets.push(request);
    },
  });
  return { auth, resets };
}

let ipSequence = 0;
/** A distinct client IP per call, so rate-limit buckets never collide. */
export const uniqueIp = () => {
  ipSequence += 1;
  return `10.${Math.floor(ipSequence / 250) % 250}.${ipSequence % 250}.7`;
};

let adminSequence = 0;

export async function createAdmin(
  db: PrismaClient,
  {
    role = "ADMIN",
    isActive = true,
    email,
    password,
  }: {
    role?: "OWNER" | "ADMIN";
    isActive?: boolean;
    email?: string;
    /** Omit to create an administrator without any credential. */
    password?: string;
  } = {},
) {
  adminSequence += 1;
  const admin = await db.adminUser.create({
    data: {
      name: `Admin ${adminSequence}`,
      email: email ?? `admin-${adminSequence}@heavycards.test`,
      role,
      isActive,
      emailVerified: true,
    },
  });
  if (password) {
    await db.adminAccount.create({
      data: {
        userId: admin.id,
        providerId: "credential",
        accountId: admin.id,
        password: await hashPassword(password),
      },
    });
  }
  return admin;
}

export function authRequest(
  path: string,
  {
    body,
    cookie,
    ip = uniqueIp(),
    origin = TEST_BASE_URL,
    baseURL = TEST_BASE_URL,
    method = "POST",
    headers: extraHeaders = {},
  }: {
    body?: unknown;
    cookie?: string;
    ip?: string;
    origin?: string;
    baseURL?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers({
    "x-forwarded-for": ip,
    origin,
    ...extraHeaders,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${baseURL}/api/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type TestAuth = ReturnType<typeof createTestAuth>["auth"];

export function signIn(
  auth: TestAuth,
  email: string,
  password: string,
  options: {
    ip?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return auth.handler(
    authRequest("/sign-in/email", { body: { email, password }, ...options }),
  );
}

/** `name=value` pairs from a response's Set-Cookie headers. */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

export const cookieHeaders = (cookie: string) => new Headers({ cookie });
