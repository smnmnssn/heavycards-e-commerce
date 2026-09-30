import type { ComponentProps } from "react";

/*
 * Minimal outline icon set (24×24 grid, 1.5px stroke, currentColor). Icons
 * are decorative (`aria-hidden`); the surrounding control carries the
 * accessible name. Hand-drawn instead of an icon library dependency to keep
 * the bundle small and the stroke style consistent.
 */

type IconProps = ComponentProps<"svg">;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      width={24}
      height={24}
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="m15.25 15.25 5 5" />
    </Icon>
  );
}

export function BagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.75 8.25h14.5l-1 12H5.75l-1-12Z" />
      <path d="M8.75 8.25V6.5a3.25 3.25 0 0 1 6.5 0v1.75" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.75 9h16.5M3.75 15h16.5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15.5M13.5 6l6 6-6 6" />
    </Icon>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </Icon>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 6.25h11v9.5h-11zM13.75 9.75h3.75l2.75 3v3h-6.5" />
      <circle cx="6.75" cy="17.25" r="1.75" />
      <circle cx="17" cy="17.25" r="1.75" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.25 10.75h13.5v9.5H5.25z" />
      <path d="M8.25 10.75v-3a3.75 3.75 0 0 1 7.5 0v3" />
    </Icon>
  );
}
