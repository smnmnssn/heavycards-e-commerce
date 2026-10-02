"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type AdminNavItem = { href: string; label: string };

/**
 * Admin section links; marks the current section with aria-current.
 *
 * On phones and tablets the links form one horizontally scrollable row
 * (the page itself never scrolls sideways), and the current section is
 * scrolled into view; from `lg` they wrap as a plain row.
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const currentRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Adminmeny" className="-mx-4 sm:mx-0">
      <ul className="flex snap-x [scrollbar-width:none] gap-x-6 overflow-x-auto px-4 sm:px-0 lg:flex-wrap lg:overflow-visible">
        {items.map(({ href, label }) => {
          const current =
            href === "/admin"
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="shrink-0 snap-start">
              <Link
                ref={current ? currentRef : undefined}
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 type-nav whitespace-nowrap transition-colors",
                  current
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
