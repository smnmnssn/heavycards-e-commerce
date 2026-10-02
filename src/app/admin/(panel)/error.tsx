"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Admin error boundary: a Swedish message and a retry, never database or
 * provider details. `digest` lets the developer find the server log entry.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] render error", error.digest ?? "");
  }, [error]);

  return (
    <section className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8">
      <p className="type-eyebrow text-muted-foreground">Något gick fel</p>
      <h1 className="mt-3 type-h2">Sidan kunde inte visas</h1>
      <p className="mt-4 text-muted-foreground">
        Ett tillfälligt fel uppstod. Försök igen; om felet kvarstår, logga ut
        och in igen.
        {error.digest && ` Felkod: ${error.digest}.`}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>Försök igen</Button>
        <ButtonLink href="/admin" variant="secondary">
          Till översikten
        </ButtonLink>
      </div>
    </section>
  );
}
