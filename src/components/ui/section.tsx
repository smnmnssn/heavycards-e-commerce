import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type SectionProps = ComponentProps<"section"> & {
  /** Background treatment; `inverted` is the black brand surface. */
  tone?: "default" | "surface" | "inverted";
  /** Vertical rhythm: `default` for page sections, `compact` for bands. */
  spacing?: "default" | "compact";
};

export function Section({
  tone = "default",
  spacing = "default",
  className,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(
        spacing === "default" ? "py-16 sm:py-20 lg:py-28" : "py-10 sm:py-12",
        tone === "surface" && "bg-surface",
        tone === "inverted" && "surface-inverted",
        className,
      )}
      {...props}
    />
  );
}
