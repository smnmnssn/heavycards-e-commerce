/**
 * Fixed market configuration for V1 (Sweden only, see PROJECT.md §3).
 *
 * Commercial values such as shipping prices or the store's contact details do
 * not belong here; they live in the database-backed store settings.
 */
export const siteConfig = {
  brandName: "HeavyCards",
  htmlLang: "sv",
  locale: "sv-SE",
  currency: "SEK",
  country: "SE",
  timeZone: "Europe/Stockholm",
} as const;
