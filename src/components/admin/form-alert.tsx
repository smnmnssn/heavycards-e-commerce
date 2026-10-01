import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Form-level message. Errors use role="alert" so they are announced when
 * they appear; confirmations use role="status".
 */
export function FormAlert({
  tone,
  children,
  className,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        tone === "error"
          ? "border-destructive font-medium text-destructive"
          : "border-border bg-muted text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
