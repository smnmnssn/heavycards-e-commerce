import "server-only";

import { unstable_rethrow } from "next/navigation";

import { ForbiddenError, type AdminIdentity } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";

import type { AdminRule } from "./access";

/** Result of an admin form action (orders, reviews, settings). */
export type AdminFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Partial<Record<string, string>>;
    };

export const INVALID_FORM_REQUEST: AdminFormState = {
  status: "error",
  message: "Ogiltig begäran. Ladda om sidan och försök igen.",
};

const UNEXPECTED: AdminFormState = {
  status: "error",
  message: "Något gick fel. Ladda om sidan och försök igen.",
};

/**
 * Runs an admin server action for the signed-in administrator.
 *
 * Authorization happens here, on the server, for every call: no valid
 * session → redirect to the login page; a role failing `rule` → the
 * `forbidden` message. The services re-check the account inside their
 * transaction, so a ForbiddenError from there gives the same message.
 * Unexpected failures are logged by error name only and shown generically,
 * so database or provider details never reach the browser.
 */
export async function runAdminAction<T extends AdminFormState>(
  { rule, forbidden }: { rule: AdminRule; forbidden: string },
  action: (admin: AdminIdentity) => Promise<T>,
): Promise<T | AdminFormState> {
  try {
    const admin = await requireAdmin();
    if (!rule(admin)) return { status: "error", message: forbidden };
    return await action(admin);
  } catch (error) {
    // Redirects (sign-in) are Next.js control flow.
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) {
      return { status: "error", message: forbidden };
    }
    console.error("[admin] action failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return UNEXPECTED;
  }
}
