/**
 * Information and legal pages. Content is written and legally reviewed by
 * the store owner before launch (PROJECT.md §71); until then each page is a
 * `noindex` placeholder. When a page gets its real, reviewed content, set
 * `indexable: true`: that removes `noindex` and adds it to the sitemap.
 * See docs/routes.md.
 */

export type InfoPageSlug =
  | "om-oss"
  | "kontakt"
  | "leveransinformation"
  | "retur-och-angerratt"
  | "kopvillkor"
  | "integritetspolicy"
  | "cookiepolicy";

export type InfoPage = Readonly<{
  title: string;
  description: string;
  /** Legal texts are grouped under "Kundservice" or "Villkor" in breadcrumbs. */
  section: "HeavyCards" | "Kundservice" | "Villkor";
  /** Published, reviewed content: indexed and listed in the sitemap. */
  indexable: boolean;
}>;

export const infoPages: Readonly<Record<InfoPageSlug, InfoPage>> = {
  "om-oss": {
    title: "Om oss",
    description: "Om HeavyCards, en svensk butik för Pokémon TCG-produkter.",
    section: "HeavyCards",
    indexable: false,
  },
  kontakt: {
    title: "Kontakt",
    description: "Kontakta HeavyCards kundservice.",
    section: "Kundservice",
    indexable: false,
  },
  leveransinformation: {
    title: "Leveransinformation",
    description: "Leveranssätt, leveranstider och fraktkostnader.",
    section: "Kundservice",
    indexable: false,
  },
  "retur-och-angerratt": {
    title: "Retur & ångerrätt",
    description: "Så returnerar du en vara och använder din ångerrätt.",
    section: "Kundservice",
    indexable: false,
  },
  kopvillkor: {
    title: "Köpvillkor",
    description: "Villkor för köp hos HeavyCards.",
    section: "Villkor",
    indexable: false,
  },
  integritetspolicy: {
    title: "Integritetspolicy",
    description: "Hur HeavyCards behandlar personuppgifter.",
    section: "Villkor",
    indexable: false,
  },
  cookiepolicy: {
    title: "Cookiepolicy",
    description: "Hur HeavyCards använder cookies.",
    section: "Villkor",
    indexable: false,
  },
};
