"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isActiveHref } from "@/lib/config/navigation";

type NavLinkProps = ComponentProps<typeof Link> & { href: string };

/**
 * Link that marks itself `aria-current="page"` for the current section. This
 * is the only reason it is a client component: the header stays a server
 * component and only these small links hydrate.
 */
export function NavLink({ href, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const active = isActiveHref(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      {...props}
    />
  );
}
