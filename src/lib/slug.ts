/**
 * URL slugs: lowercase ASCII words joined by single hyphens, matching the
 * database CHECK `^[a-z0-9]+(-[a-z0-9]+)*$` (docs/database.md). Isomorphic,
 * so the admin forms suggest exactly what the server accepts.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Swedish letters are transliterated as in the existing routes (å/ä → a,
// ö → o, docs/routes.md). Other accents are removed by Unicode decomposition.
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  å: "a",
  ä: "a",
  ö: "o",
  æ: "ae",
  ø: "o",
  ß: "ss",
  "&": " och ",
};

/** "Pokémon Destined Rivals – Booster Box" → "pokemon-destined-rivals-booster-box". */
export function slugify(text: string, maxLength = 200): string {
  const slug = text
    .toLowerCase()
    .replace(/[åäöæøß&]/g, (char) => TRANSLITERATIONS[char] ?? char)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength).replace(/-+$/, "");
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
