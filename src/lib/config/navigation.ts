/**
 * Storefront navigation, defined once and shared by the desktop header, the
 * mobile menu and the footer. Routes are documented in docs/routes.md.
 */

export type NavItem = Readonly<{ label: string; href: string }>;

export type NavGroup = Readonly<{ title: string; items: readonly NavItem[] }>;

/** Intentionally short (PROJECT.md §9): no per-category links in the header. */
export const primaryNavigation: readonly NavItem[] = [
  { label: "Nyheter", href: "/nyheter" },
  { label: "Pokémon TCG", href: "/pokemon-tcg" },
  { label: "Kommande", href: "/kommande" },
  { label: "Om oss", href: "/om-oss" },
];

export const customerServiceNavigation: readonly NavItem[] = [
  { label: "Kontakt", href: "/kontakt" },
  { label: "Leveransinformation", href: "/leveransinformation" },
  { label: "Retur & ångerrätt", href: "/retur-och-angerratt" },
];

export const footerNavigation: readonly NavGroup[] = [
  {
    title: "Handla",
    items: [
      { label: "Nyheter", href: "/nyheter" },
      { label: "Pokémon TCG", href: "/pokemon-tcg" },
      { label: "Kommande", href: "/kommande" },
    ],
  },
  { title: "Kundservice", items: customerServiceNavigation },
  {
    title: "Information",
    items: [
      { label: "Om oss", href: "/om-oss" },
      { label: "Köpvillkor", href: "/kopvillkor" },
      { label: "Integritetspolicy", href: "/integritetspolicy" },
      { label: "Cookiepolicy", href: "/cookiepolicy" },
    ],
  },
];

export const searchPath = "/sok";

/** True when `href` is the current page or a section containing it. */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
