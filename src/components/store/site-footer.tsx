import Link from "next/link";

import { Container } from "@/components/ui/container";
import { footerNavigation } from "@/lib/config/navigation";
import { siteConfig } from "@/lib/config/site";

/**
 * Storefront footer on the inverted (black) brand surface. Company details
 * such as organisationsnummer come from store settings in a later milestone.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="surface-inverted mt-auto">
      <Container className="pt-16 pb-10 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr] lg:gap-16">
          <div className="max-w-sm">
            <p className="text-lg leading-none font-extrabold tracking-[0.04em] uppercase [font-stretch:125%]">
              {siteConfig.brandName}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Förseglade Pokémon TCG-produkter för samlare och spelare i
              Sverige.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
            {footerNavigation.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <p className="type-eyebrow text-muted-foreground">
                  {group.title}
                </p>
                <ul className="mt-4 space-y-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="inline-flex min-h-10 items-center text-sm text-foreground underline-offset-4 hover:underline"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-border pt-8 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            © {year} {siteConfig.brandName}
          </p>
          <p className="max-w-xl sm:text-right">
            {siteConfig.brandName} är en oberoende återförsäljare och är inte
            ansluten till eller godkänd av The Pokémon Company, Nintendo,
            Creatures eller Game Freak.
          </p>
        </div>
      </Container>
    </footer>
  );
}
