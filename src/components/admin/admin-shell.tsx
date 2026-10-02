import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/app/admin/(panel)/actions";
import { BrandMark } from "@/components/store/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import {
  canManageCatalog,
  canManageOrders,
  canManageReviews,
  type AdminIdentity,
} from "@/lib/auth/authorization";
import {
  ADMIN_CATEGORIES_PATH,
  ADMIN_HOME_PATH,
  ADMIN_ORDERS_PATH,
  ADMIN_PRODUCTS_PATH,
  ADMIN_REVIEWS_PATH,
  ADMIN_SETS_PATH,
  ADMIN_SETTINGS_PATH,
  ADMIN_USERS_PATH,
} from "@/lib/auth/routes";
import { siteConfig } from "@/lib/config/site";

import { AdminNav, type AdminNavItem } from "./admin-nav";
import { ROLE_LABELS } from "./roles";

const MAIN_ID = "innehall";

/**
 * Admin frame: identity, navigation and sign-out. Links to OWNER-only areas
 * are hidden for ADMIN as a convenience; the pages and actions enforce it.
 */
export function AdminShell({
  admin,
  children,
}: {
  admin: AdminIdentity;
  children: ReactNode;
}) {
  const items: AdminNavItem[] = [{ href: ADMIN_HOME_PATH, label: "Översikt" }];
  if (canManageOrders(admin)) {
    items.push({ href: ADMIN_ORDERS_PATH, label: "Beställningar" });
  }
  if (canManageReviews(admin)) {
    items.push({ href: ADMIN_REVIEWS_PATH, label: "Recensioner" });
  }
  if (canManageCatalog(admin)) {
    items.push(
      { href: ADMIN_PRODUCTS_PATH, label: "Produkter" },
      { href: ADMIN_CATEGORIES_PATH, label: "Kategorier" },
      { href: ADMIN_SETS_PATH, label: "Pokémon-set" },
    );
  }
  // Every administrator may read the settings; only an OWNER may change them.
  items.push({ href: ADMIN_SETTINGS_PATH, label: "Inställningar" });
  if (admin.role === "OWNER") {
    items.push({ href: ADMIN_USERS_PATH, label: "Administratörer" });
  }

  return (
    <>
      <a
        href={`#${MAIN_ID}`}
        className="fixed top-2 left-2 z-50 -translate-y-24 bg-foreground px-4 py-3 type-nav text-background focus-visible:translate-y-0"
      >
        Hoppa till innehållet
      </a>
      <header className="border-b border-border bg-background">
        <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
          <div className="flex items-center gap-4">
            <Link
              href={ADMIN_HOME_PATH}
              aria-label={`${siteConfig.brandName} admin – översikt`}
              className="inline-flex items-center py-1"
            >
              <BrandMark className="h-8" />
            </Link>
            <span className="type-eyebrow text-muted-foreground">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="min-w-0 text-right" data-testid="admin-identity">
              <p className="truncate text-sm font-semibold">{admin.name}</p>
              <p className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="hidden truncate sm:inline">{admin.email}</span>
                <Badge variant="outline">{ROLE_LABELS[admin.role]}</Badge>
              </p>
            </div>
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="h-11"
              >
                Logga ut
              </Button>
            </form>
          </div>
        </Container>
        <Container className="border-t border-border">
          <AdminNav items={items} />
        </Container>
      </header>
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="flex-1 bg-surface outline-none"
      >
        <Container className="py-8 sm:py-12">{children}</Container>
      </main>
    </>
  );
}
