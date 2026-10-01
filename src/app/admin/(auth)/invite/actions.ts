"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { ADMIN_LOGIN_PATH } from "@/lib/auth/routes";
import { db } from "@/lib/db/client";
import { acceptInvitation } from "@/server/admin/invitations";

export type AcceptInviteState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      field?: "password" | "confirmPassword";
      invalidToken?: boolean;
    };

/**
 * Activates an invited administrator. Authorized by the invitation token
 * alone; email and role come from the stored invitation, never the form.
 */
export async function acceptInviteAction(
  _previous: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const password = formData.get("password");
  if (
    typeof password !== "string" ||
    password !== formData.get("confirmPassword")
  ) {
    return {
      status: "error",
      field: "confirmPassword",
      message: "Lösenorden matchar inte.",
    };
  }

  const context = await auth.$context;
  const result = await acceptInvitation(db, {
    token: formData.get("token"),
    password,
    hashPassword: (value) => context.password.hash(value),
  });
  if (!result.ok) {
    return result.error === "INVALID_PASSWORD"
      ? {
          status: "error",
          field: "password",
          message: result.message ?? "Ogiltigt lösenord.",
        }
      : {
          status: "error",
          invalidToken: true,
          message:
            "Inbjudan är ogiltig, har redan använts eller har gått ut. Be en ägare att skicka en ny.",
        };
  }
  redirect(`${ADMIN_LOGIN_PATH}?notice=activated`);
}
