/**
 * Information and legal pages. Content is written and legally reviewed by
 * the store owner before launch (PROJECT.md §71); until then each page is a
 * `noindex` placeholder. See docs/routes.md.
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
}>;

export const infoPages: Readonly<Record<InfoPageSlug, InfoPage>> = {
  "om-oss": {
    title: "Om oss",
    description: "Om HeavyCards, en svensk butik för Pokémon TCG-produkter.",
    section: "HeavyCards",
  },
  kontakt: {
    title: "Kontakt",
    description: "Kontakta HeavyCards kundservice.",
    section: "Kundservice",
  },
  leveransinformation: {
    title: "Leveransinformation",
    description: "Leveranssätt, leveranstider och fraktkostnader.",
    section: "Kundservice",
  },
  "retur-och-angerratt": {
    title: "Retur & ångerrätt",
    description: "Så returnerar du en vara och använder din ångerrätt.",
    section: "Kundservice",
  },
  kopvillkor: {
    title: "Köpvillkor",
    description: "Villkor för köp hos HeavyCards.",
    section: "Villkor",
  },
  integritetspolicy: {
    title: "Integritetspolicy",
    description: "Hur HeavyCards behandlar personuppgifter.",
    section: "Villkor",
  },
  cookiepolicy: {
    title: "Cookiepolicy",
    description: "Hur HeavyCards använder cookies.",
    section: "Villkor",
  },
};
