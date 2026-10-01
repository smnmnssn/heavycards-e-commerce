import {
  BASE_ERROR_CODES,
  betterAuth,
  type BetterAuthPlugin,
} from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  ADMIN_COOKIE_PREFIX,
  DISABLED_AUTH_ENDPOINTS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_TOKEN_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from "./policy";

/**
 * Built exactly like Better Auth's own wrong-password error, so the response
 * (status, body and its key order) is byte-identical.
 */
const invalidCredentials = () =>
  APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);

export type PasswordResetRequest = {
  user: { id: string; email: string; name: string };
  /** Raw single-use token. Goes into the emailed link only; never log it. */
  token: string;
};

export type AuthDependencies = {
  db: PrismaClient;
  /** Public origin; the auth API lives under `${baseURL}/api/auth`. */
  baseURL: string;
  secret: string;
  /** Called only for active administrators. */
  sendPasswordReset: (request: PasswordResetRequest) => Promise<void>;
  /** Framework integration, e.g. `nextCookies()` (must come last). */
  plugins?: BetterAuthPlugin[];
};

/**
 * Builds the Better Auth instance for administrators.
 *
 * A factory rather than a module singleton so database tests can run the
 * real configuration against the test database. The application instance is
 * created in `./server.ts`.
 */
export function createAuth({
  db,
  baseURL,
  secret,
  sendPasswordReset,
  plugins = [],
}: AuthDependencies) {
  return betterAuth({
    appName: "HeavyCards Admin",
    baseURL,
    secret,
    database: prismaAdapter(db, { provider: "postgresql" }),
    telemetry: { enabled: false },

    // AdminUser is Better Auth's user: one identity per administrator.
    // role/isActive are `input: false`, so no auth endpoint can set them.
    user: {
      modelName: "adminUser",
      additionalFields: {
        role: { type: "string", required: false, input: false },
        isActive: { type: "boolean", required: false, input: false },
      },
    },
    account: {
      modelName: "adminAccount",
      accountLinking: { enabled: false },
    },
    session: {
      modelName: "adminSession",
      expiresIn: SESSION_TTL_SECONDS,
      disableSessionRefresh: true,
      // Every lookup reads the database, so deactivation and sign-out take
      // effect on the next request instead of after a cache window.
      cookieCache: { enabled: false },
    },
    verification: {
      modelName: "authVerification",
      storeIdentifier: "hashed",
    },

    emailAndPassword: {
      enabled: true,
      // Administrators are only created by the bootstrap CLI or an accepted
      // invitation. The endpoint is also unreachable (see disabledPaths).
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const { isActive } = user as typeof user & { isActive?: boolean };
        if (isActive !== true) return;
        await sendPasswordReset({
          user: { id: user.id, email: user.email, name: user.name },
          token,
        });
      },
    },

    disabledPaths: [...DISABLED_AUTH_ENDPOINTS],

    databaseHooks: {
      session: {
        create: {
          // Inactive administrators never get a session, even with the right
          // password. The error matches a wrong password so the response
          // reveals nothing about the account.
          before: async (session) => {
            const admin = await db.adminUser.findUnique({
              where: { id: session.userId },
              select: { isActive: true },
            });
            if (!admin?.isActive) throw invalidCredentials();
          },
        },
      },
    },

    // Counters live in PostgreSQL so every serverless instance shares them.
    // Keys are client IP + path. On Vercel `x-forwarded-for` is set by the
    // platform; elsewhere the proxy in front must overwrite it.
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "authRateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 300, max: 10 },
        "/request-password-reset": { window: 900, max: 5 },
        "/reset-password": { window: 900, max: 10 },
      },
    },

    advanced: {
      // Explicit: Better Auth skips the origin check by default when
      // NODE_ENV=test. Origin/CSRF protection stays on everywhere.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: ADMIN_COOKIE_PREFIX,
      useSecureCookies: baseURL.startsWith("https://"),
      // Prisma's @default(uuid(7)) generates every primary key.
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },

    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
