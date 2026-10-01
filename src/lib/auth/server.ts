import "server-only";

import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";

import { db } from "@/lib/db/client";
import { passwordResetEmail } from "@/lib/email/templates";
import { emailTransport } from "@/lib/email/server";
import { maskEmail } from "@/lib/email/transport";
import { env } from "@/lib/env/server";

import { createAuth } from "./config";
import { ADMIN_RESET_PASSWORD_PATH } from "./routes";

/** The application's Better Auth instance. */
export const auth = createAuth({
  db,
  baseURL: env.siteUrl,
  secret: env.authSecret,
  // Delivery runs after the response so the reply time does not reveal
  // whether the address belongs to an administrator.
  sendPasswordReset: async ({ user, token }) => {
    const url = new URL(ADMIN_RESET_PASSWORD_PATH, env.siteUrl);
    url.searchParams.set("token", token);
    const message = passwordResetEmail({
      to: user.email,
      name: user.name,
      url: url.toString(),
    });
    after(async () => {
      try {
        await emailTransport.send(message);
      } catch (error) {
        console.error(
          `[auth] password reset email to ${maskEmail(user.email)} failed:`,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    });
  },
  // Lets server actions that call auth.api set or clear cookies.
  plugins: [nextCookies()],
});
