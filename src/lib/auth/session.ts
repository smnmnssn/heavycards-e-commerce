import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import {
  canManageCatalog,
  ForbiddenError,
  isOwner,
  resolveAdminSession,
  type AdminIdentity,
} from "./authorization";
import { ADMIN_PATH_HEADER, loginUrlFor } from "./routes";
import { auth } from "./server";

/**
 * Server-side authorization for admin pages, server actions and route
 * handlers. Every sensitive entry point calls one of these itself; the proxy
 * only redirects early and is never the security boundary.
 */

/** The current administrator, or null. Deduplicated per request. */
export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> =>
  resolveAdminSession(auth, await headers()),
);

/**
 * Requires an active administrator; otherwise redirects to the login page,
 * which returns to the current admin page after signing in.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    const path = (await headers()).get(ADMIN_PATH_HEADER) ?? "";
    redirect(loginUrlFor(path));
  }
  return admin;
}

/**
 * Requires an active OWNER. Redirects anonymous visitors to the login page and
 * throws ForbiddenError for an ADMIN.
 */
export async function requireOwner(): Promise<AdminIdentity> {
  const admin = await requireAdmin();
  if (!isOwner(admin)) {
    throw new ForbiddenError("Endast ägare (OWNER) har behörighet.");
  }
  return admin;
}

/**
 * Requires an active administrator allowed to manage the catalog. Redirects
 * anonymous visitors to the login page and throws ForbiddenError otherwise.
 */
export async function requireCatalogManager(): Promise<AdminIdentity> {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) {
    throw new ForbiddenError("Behörighet saknas för katalogen.");
  }
  return admin;
}
