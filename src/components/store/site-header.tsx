import Link from "next/link";

import { CartTrigger } from "@/components/cart/cart-trigger";
import { SearchIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/container";
import {
  customerServiceNavigation,
  primaryNavigation,
  searchPath,
} from "@/lib/config/navigation";

import { HeaderSearch } from "./header-search";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";

/**
 * Storefront header (server component). Only three small pieces hydrate on
 * the client: the active-state nav links, the mobile menu toggle and the
 * cart trigger.
 *
 * Mobile (< lg): menu · centered logo · search + cart.
 * Desktop (≥ lg): logo · primary navigation · search field + cart.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Container className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 lg:h-18 lg:grid-cols-[auto_1fr_auto] lg:gap-10">
        <div className="-ml-2.5 flex items-center lg:hidden">
          <MobileMenu>
            <MobileMenuContent />
          </MobileMenu>
        </div>

        <Logo className="justify-self-center lg:justify-self-start" />

        <nav aria-label="Huvudmeny" className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {primaryNavigation.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  className="relative inline-flex h-18 items-center type-nav text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-foreground after:transition-transform after:duration-200 after:ease-(--ease-out-soft) hover:after:scale-x-100 data-active:after:scale-x-100"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="-mr-2.5 flex items-center justify-self-end lg:mr-0 lg:gap-2">
          <HeaderSearch className="hidden w-64 lg:block xl:w-72" />
          <Link
            href={searchPath}
            aria-label="Sök"
            className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted lg:hidden"
          >
            <SearchIcon className="size-6" />
          </Link>
          <CartTrigger />
        </div>
      </Container>
    </header>
  );
}

/** Server-rendered contents of the mobile menu drawer. */
function MobileMenuContent() {
  return (
    <div className="flex flex-col gap-8 px-4 pt-6 pb-10">
      <HeaderSearch />

      <nav aria-label="Huvudmeny">
        <ul className="border-t border-border">
          {primaryNavigation.map((item) => (
            <li key={item.href} className="border-b border-border">
              <NavLink
                href={item.href}
                className="flex min-h-14 items-center text-xl font-bold tracking-[0.02em] uppercase [font-stretch:118%] data-active:underline data-active:decoration-2 data-active:underline-offset-8"
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Kundservice">
        <p className="type-eyebrow text-muted-foreground">Kundservice</p>
        <ul className="mt-3">
          {customerServiceNavigation.map((item) => (
            <li key={item.href}>
              <NavLink
                href={item.href}
                className="flex min-h-11 items-center text-base text-foreground hover:underline hover:underline-offset-4 data-active:font-semibold"
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
