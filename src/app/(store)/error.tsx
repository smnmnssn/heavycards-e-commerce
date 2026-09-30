"use client";

import { useEffect } from "react";

import { PageHeader } from "@/components/store/headings";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

/**
 * Customer-facing error boundary: a Swedish message and a retry, never
 * internal details (PROJECT.md §72). The error itself is logged server-side;
 * `digest` lets support correlate it with server logs.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[store] render error", error.digest ?? "");
  }, [error]);

  return (
    <Container className="py-20 sm:py-28">
      <PageHeader
        eyebrow="Något gick fel"
        title="Sidan kunde inte visas"
        lead="Ett tillfälligt fel uppstod. Försök igen om en liten stund."
      />
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button onClick={reset}>Försök igen</Button>
        <ButtonLink href="/" variant="secondary">
          Till startsidan
        </ButtonLink>
      </div>
    </Container>
  );
}
