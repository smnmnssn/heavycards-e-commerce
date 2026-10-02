/** Rendered instead of a page for a signed-in role without access to it. */
export function ForbiddenPanel({ message }: { message: string }) {
  return (
    <section
      aria-labelledby="behorighet-saknas"
      className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8"
    >
      <p className="type-eyebrow text-muted-foreground">403</p>
      <h1 id="behorighet-saknas" className="mt-3 type-h2">
        Behörighet saknas
      </h1>
      <p className="mt-4 text-muted-foreground">{message}</p>
    </section>
  );
}
