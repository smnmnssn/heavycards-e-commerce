import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/*
 * Form primitives. 16px text prevents iOS from zooming on focus; 44px height
 * meets touch-target guidance; borders meet 3:1 non-text contrast.
 * `aria-invalid` switches to the error style, so validation state and its
 * accessible representation can never drift apart.
 */

const fieldBase =
  "w-full rounded-md border border-input bg-background px-3.5 text-base text-foreground " +
  "placeholder:text-muted-foreground transition-colors duration-150 " +
  "hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-destructive aria-invalid:outline-destructive";

export function Input({
  className,
  type = "text",
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(fieldBase, "h-11", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldBase, "min-h-32 py-3 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(fieldBase, "h-11 cursor-pointer", className)}
      {...props}
    />
  );
}

/** Native checkbox: 20px box inside a 44px row from its label. */
export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-5 shrink-0 cursor-pointer accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

type FieldMessageProps = ComponentProps<"p"> & {
  tone?: "hint" | "error";
};

/** Help or error text; link it to the control with `aria-describedby`. */
export function FieldMessage({
  tone = "hint",
  className,
  ...props
}: FieldMessageProps) {
  return (
    <p
      className={cn(
        "text-sm",
        tone === "error"
          ? "font-medium text-destructive"
          : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
