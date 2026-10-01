import { FieldMessage, Input, Label } from "@/components/ui/form";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

/**
 * "New password" + "confirm" pair. Plain password inputs with
 * autocomplete="new-password", so password managers can generate and save a
 * password and pasting always works.
 */
export function NewPasswordFields({
  error,
  errorField,
}: {
  error?: string | null;
  errorField?: "password" | "confirmPassword";
}) {
  const passwordError = errorField === "password" ? error : null;
  const confirmError = errorField === "confirmPassword" ? error : null;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="new-password">Nytt lösenord</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby="new-password-hint"
        />
        <FieldMessage
          id="new-password-hint"
          tone={passwordError ? "error" : "hint"}
        >
          {passwordError ??
            `Minst ${MIN_PASSWORD_LENGTH} tecken. En lång lösenfras är bra; alla tecken är tillåtna.`}
        </FieldMessage>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Upprepa lösenordet</Label>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          required
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "confirm-password-error" : undefined}
        />
        {confirmError && (
          <FieldMessage id="confirm-password-error" tone="error">
            {confirmError}
          </FieldMessage>
        )}
      </div>
    </>
  );
}
