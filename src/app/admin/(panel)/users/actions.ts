"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ForbiddenError, type AdminIdentity } from "@/lib/auth/authorization";
import { ADMIN_USERS_PATH } from "@/lib/auth/routes";
import { requireOwner } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { emailTransport } from "@/lib/email/server";
import { env } from "@/lib/env/server";
import { setAdminActive } from "@/server/admin/admin-users";
import { inviteAdmin, revokeInvitation } from "@/server/admin/invitations";

/**
 * OWNER-only administrator management. Every action re-authorizes on the
 * server (session → requireOwner, then the service re-checks the role inside
 * its transaction). Hidden buttons are never relied on.
 */

export type AdminActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Partial<Record<"name" | "email", string>>;
    };

const FORBIDDEN: AdminActionState = {
  status: "error",
  message: "Endast ägare (OWNER) kan hantera administratörer.",
};

/** Runs `action` as the current OWNER; ADMINs get FORBIDDEN back. */
async function asOwner(
  action: (owner: AdminIdentity) => Promise<AdminActionState>,
): Promise<AdminActionState> {
  try {
    // Redirects (not signed in) propagate; only role failures are caught.
    const owner = await requireOwner();
    return await action(owner);
  } catch (error) {
    if (error instanceof ForbiddenError) return FORBIDDEN;
    throw error;
  }
}

const idSchema = z.uuid();

export async function inviteAdminAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return asOwner(async (owner) => {
    // Only name and email are read; a posted role is ignored by design.
    const result = await inviteAdmin(db, emailTransport, {
      actorId: owner.id,
      input: { name: formData.get("name"), email: formData.get("email") },
      siteUrl: env.siteUrl,
    });
    if (!result.ok) {
      switch (result.error) {
        case "INVALID_INPUT":
          return {
            status: "error",
            message: "Kontrollera uppgifterna.",
            fieldErrors: result.fieldErrors,
          };
        case "ALREADY_ADMIN":
          return {
            status: "error",
            message: "Det finns redan en administratör med den e-postadressen.",
            fieldErrors: { email: "Adressen används redan." },
          };
        case "EMAIL_FAILED":
          return {
            status: "error",
            message:
              "Inbjudan kunde inte skickas, så ingen inbjudan skapades. Försök igen.",
          };
      }
    }
    revalidatePath(ADMIN_USERS_PATH);
    return { status: "success", message: "Inbjudan är skickad." };
  });
}

export async function setAdminActiveAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return asOwner(async (owner) => {
    const targetId = idSchema.safeParse(formData.get("adminUserId"));
    const active = formData.get("active");
    if (!targetId.success || (active !== "true" && active !== "false")) {
      return { status: "error", message: "Ogiltig begäran." };
    }
    const result = await setAdminActive(db, {
      actorId: owner.id,
      targetId: targetId.data,
      active: active === "true",
    });
    if (!result.ok) {
      const messages = {
        NOT_FOUND: "Administratören finns inte.",
        LAST_OWNER: "Den sista aktiva ägaren kan inte inaktiveras.",
        SELF: "Du kan inte inaktivera ditt eget konto.",
      } as const;
      return { status: "error", message: messages[result.error] };
    }
    revalidatePath(ADMIN_USERS_PATH);
    return {
      status: "success",
      message:
        active === "true" ? "Kontot är aktiverat." : "Kontot är inaktiverat.",
    };
  });
}

export async function revokeInvitationAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return asOwner(async (owner) => {
    const invitationId = idSchema.safeParse(formData.get("invitationId"));
    if (!invitationId.success) {
      return { status: "error", message: "Ogiltig begäran." };
    }
    const result = await revokeInvitation(db, {
      actorId: owner.id,
      invitationId: invitationId.data,
    });
    if (!result.ok) {
      return {
        status: "error",
        message: "Inbjudan är redan använd eller återkallad.",
      };
    }
    revalidatePath(ADMIN_USERS_PATH);
    return { status: "success", message: "Inbjudan är återkallad." };
  });
}
