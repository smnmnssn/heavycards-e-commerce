import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonStyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md whitespace-nowrap select-none " +
  "transition-[background-color,color,border-color,opacity] duration-150 ease-(--ease-out-soft) " +
  "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 " +
  "[&_svg]:size-5 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "type-nav bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
  secondary:
    "type-nav border border-foreground bg-transparent text-foreground hover:bg-foreground hover:text-background",
  ghost: "text-foreground hover:bg-muted",
  link: "h-auto px-0 font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2",
};

// md and lg meet the 44×44 px minimum touch target.
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4",
  md: "h-11 px-6",
  lg: "h-13 px-8",
  icon: "size-11",
};

/** Shared class builder so links and buttons look identical. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: ButtonStyleProps = {}): string {
  return cn(
    base,
    variants[variant],
    variant !== "link" && sizes[size],
    fullWidth && "w-full",
  );
}

export type ButtonProps = ComponentProps<"button"> & ButtonStyleProps;

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & ButtonStyleProps;

/** A navigation link styled as a button (never a button that navigates). */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(buttonClasses({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
}
