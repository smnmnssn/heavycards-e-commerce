import type { ReactNode } from "react";

/** Frame for the public admin pages (login, password reset, invitations). */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="auth-title"
      className="rounded-lg border border-border bg-background p-6 sm:p-8"
    >
      <h1 id="auth-title" className="type-h2">
        {title}
      </h1>
      {description && (
        <div className="mt-3 text-muted-foreground">{description}</div>
      )}
      <div className="mt-8">{children}</div>
    </section>
  );
}
