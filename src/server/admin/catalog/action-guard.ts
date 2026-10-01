import "server-only";

import { unstable_rethrow } from "next/navigation";

import { ForbiddenError, type AdminIdentity } from "@/lib/auth/authorization";
import { requireCatalogManager } from "@/lib/auth/session";
import type { FieldErrors } from "@/lib/validation/catalog";

export type CatalogActionError = {
  status: "error";
  message: string;
  fieldErrors?: FieldErrors;
};

export type CatalogActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | CatalogActionError;

export const FORBIDDEN_STATE: CatalogActionError = {
  status: "error",
  message: "Du har inte behörighet att ändra katalogen.",
};

const UNEXPECTED_STATE: CatalogActionError = {
  status: "error",
  message: "Något gick fel. Ladda om sidan och försök igen.",
};

export const INVALID_REQUEST_STATE: CatalogActionError = {
  status: "error",
  message: "Ogiltig begäran. Ladda om sidan och försök igen.",
};

/**
 * Runs a catalog server action for the signed-in administrator.
 *
 * Authorization happens here on the server for every call: no session →
 * redirect to the login page; a role without catalog access → a Swedish
 * error. The services re-check the administrator inside their transaction.
 * Unexpected failures are logged by name only and shown as a generic
 * message, so Prisma or provider details never reach the browser.
 */
export async function asCatalogManager<T extends { status: string }>(
  action: (admin: AdminIdentity) => Promise<T>,
): Promise<T | CatalogActionError> {
  try {
    const admin = await requireCatalogManager();
    return await action(admin);
  } catch (error) {
    // Redirects (sign-in, after create/delete) are Next.js control flow.
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return FORBIDDEN_STATE;
    console.error("[admin] catalog action failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return UNEXPECTED_STATE;
  }
}
