"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { FormAlert } from "../form-alert";

/**
 * A destructive action behind a confirmation. The action is a server action
 * bound to its record on the server; it redirects on success and returns a
 * Swedish error otherwise. The server decides whether deletion is allowed.
 */
export function DangerAction({
  action,
  label,
  pendingLabel,
  confirmMessage,
}: {
  action: () => Promise<{ status: string; message?: string } | undefined>;
  label: string;
  pendingLabel: string;
  confirmMessage: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-3">
      <div>
        <Button
          variant="secondary"
          className="border-destructive text-destructive hover:bg-destructive hover:text-background"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(confirmMessage)) return;
            setError(null);
            startTransition(async () => {
              const result = await action();
              if (result?.status === "error") {
                setError(result.message ?? "Åtgärden misslyckades.");
              }
            });
          }}
        >
          {pending ? pendingLabel : label}
        </Button>
      </div>
      <div aria-live="polite">
        {error && <FormAlert tone="error">{error}</FormAlert>}
      </div>
    </div>
  );
}
