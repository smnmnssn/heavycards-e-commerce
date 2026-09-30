import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type ContainerProps = ComponentProps<"div"> & {
  /** `page` for layouts (1440px), `prose` for reading width (672px). */
  size?: "page" | "prose";
};

/**
 * Horizontal page frame. Gutters grow with the viewport: 16px on phones,
 * 24px on tablets, 40px on desktop.
 */
export function Container({
  size = "page",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-10",
        size === "page" ? "max-w-page" : "max-w-prose",
        className,
      )}
      {...props}
    />
  );
}
