import { z } from "zod";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

/** Emails are compared and stored trimmed and lowercase. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const adminEmailSchema = z
  .string({ error: "Ange en e-postadress." })
  .transform(normalizeEmail)
  .pipe(
    z
      .email({ error: "Ange en giltig e-postadress." })
      .max(320, "E-postadressen är för lång."),
  );

export const adminNameSchema = z
  .string({ error: "Ange ett namn." })
  .trim()
  .min(1, "Ange ett namn.")
  .max(120, "Namnet får vara högst 120 tecken.");

/**
 * Only length is checked: no composition rules, and the value is never
 * trimmed or otherwise altered (spaces and any characters are allowed).
 */
export const adminPasswordSchema = z
  .string({ error: "Ange ett lösenord." })
  .min(
    MIN_PASSWORD_LENGTH,
    `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`,
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `Lösenordet får vara högst ${MAX_PASSWORD_LENGTH} tecken.`,
  );

/**
 * Invitation form. Deliberately has no `role` field: V1 invitations always
 * create ADMIN accounts, and anything else posted with the form is ignored.
 */
export const inviteAdminSchema = z.object({
  name: adminNameSchema,
  email: adminEmailSchema,
});
