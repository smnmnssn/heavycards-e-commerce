"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { ADMIN_LOGIN_PATH } from "@/lib/auth/routes";

/**
 * Deletes the session row and clears the cookie (via the nextCookies plugin).
 * Works without JavaScript; Next.js rejects cross-origin action requests.
 */
export async function signOutAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Already signed out or the session expired: the outcome is the same.
  }
  redirect(`${ADMIN_LOGIN_PATH}?notice=signed-out`);
}
