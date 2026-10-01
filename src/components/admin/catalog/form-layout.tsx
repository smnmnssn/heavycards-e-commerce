import type { ReactNode } from "react";

import { FieldMessage, Label } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/** A titled card that groups related form fields. */
export function FormSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "rounded-lg border border-border bg-background p-5 sm:p-8",
        className,
      )}
    >
      <h2 id={id} className="type-h3">
        {title}
      </h2>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-6 grid gap-5">{children}</div>
    </section>
  );
}

/** ids for a field's hint and error, for aria-describedby. */
export function describedBy(
  id: string,
  { hint, error }: { hint?: boolean; error?: boolean },
): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/**
 * Label, control, hint and error for one field. The control itself is
 * passed as children and must carry `id={id}`, `aria-invalid` and
 * `aria-describedby={describedBy(id, …)}`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <FieldMessage id={`${id}-hint`}>{hint}</FieldMessage>}
      {error && (
        <FieldMessage id={`${id}-error`} tone="error">
          {error}
        </FieldMessage>
      )}
    </div>
  );
}

/** Live character count against a recommended length (SEO fields). */
export function CharacterCount({
  length,
  recommended,
}: {
  length: number;
  recommended: number;
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        length > recommended && "font-semibold text-foreground",
      )}
    >
      {length} tecken
      {length > recommended
        ? ` – längre än cirka ${recommended} kan kortas av i sökresultat`
        : ` (rekommenderat högst ${recommended})`}
    </span>
  );
}
