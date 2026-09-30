import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Calm, centered message for empty listings and no search results. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-border px-6 py-14 text-center sm:py-20",
        className,
      )}
    >
      <p className="type-h3">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-muted-foreground">
          {children}
        </div>
      )}
      {action && <div className="mt-8 flex justify-center">{action}</div>}
    </div>
  );
}
