import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Neutral loading placeholder; the pulse is disabled for reduced motion. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-sm bg-muted motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}
