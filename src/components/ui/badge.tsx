import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type BadgeVariant = "solid" | "outline" | "muted";

const variants: Record<BadgeVariant, string> = {
  solid: "bg-foreground text-background",
  outline: "border border-foreground bg-background text-foreground",
  muted: "bg-muted text-foreground",
};

/** Compact status label, e.g. "Slutsåld", "Förbeställ", "Nyhet". */
export function Badge({
  variant = "solid",
  className,
  ...props
}: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm px-2 text-[0.6875rem] leading-none font-semibold tracking-[0.1em] uppercase",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
