import type { Auth } from "./config";

export type AdminRole = "OWNER" | "ADMIN";

/** The signed-in administrator, as established from a verified session. */
export type AdminIdentity = Readonly<{
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  sessionId: string;
  sessionExpiresAt: Date;
}>;

/** Raised when a signed-in administrator lacks the required role. */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const isAdminRole = (value: unknown): value is AdminRole =>
  value === "OWNER" || value === "ADMIN";

/**
 * Resolves the administrator for a request from its session cookie.
 *
 * Better Auth verifies the signed cookie and loads the session and user rows
 * from the database on every call (no cookie cache), so a deactivated
 * administrator, a revoked session or an expired session is rejected on the
 * next request. Returns null when there is no valid, active administrator.
 */
export async function resolveAdminSession(
  auth: Auth,
  headers: Headers,
): Promise<AdminIdentity | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;

  const { user, session } = result;
  if (user.isActive !== true || !isAdminRole(user.role)) return null;

  return Object.freeze({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
  });
}

export const isOwner = (admin: AdminIdentity) => admin.role === "OWNER";

/**
 * Catalog management (products, inventory, images, categories, Pokémon sets)
 * is open to both roles (PROJECT.md §50). Kept as a named rule so a future
 * role without catalog access only needs a change here.
 */
export const canManageCatalog = (admin: { role: AdminRole }) =>
  admin.role === "OWNER" || admin.role === "ADMIN";

/**
 * Order management (fulfillment status, tracking) is open to both roles
 * (PROJECT.md §50: ADMIN can manage orders).
 */
export const canManageOrders = (admin: { role: AdminRole }) =>
  admin.role === "OWNER" || admin.role === "ADMIN";

/**
 * Review moderation is open to both roles (PROJECT.md §50: ADMIN can
 * manage reviews).
 */
export const canManageReviews = (admin: { role: AdminRole }) =>
  admin.role === "OWNER" || admin.role === "ADMIN";
