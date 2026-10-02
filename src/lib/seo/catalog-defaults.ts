import { siteConfig } from "@/lib/config/site";

import { excerpt, firstText } from "./metadata";

/*
 * Title and meta-description rules for the homepage and catalog pages (docs/routes.md → SEO
 * behavior per page type). Stored SEO fields win; otherwise defaults are
 * generated from content, so administrators never have to write SEO texts.
 * Shared by the storefront pages and the admin search preview, which
 * therefore always show the same result. Isomorphic.
 */

export function productSeoTitle(product: {
  name: string;
  seoTitle: string | null;
}): string {
  return firstText(product.seoTitle) ?? product.name;
}

export function productMetaDescription(product: {
  name: string;
  seoDescription: string | null;
  shortDescription: string | null;
  description: string | null;
  setName: string | null;
}): string {
  return (
    firstText(product.seoDescription, product.shortDescription) ??
    (product.description
      ? excerpt(product.description)
      : `Köp ${product.name} hos HeavyCards${
          product.setName ? `, från setet ${product.setName}` : ""
        }. Priser inklusive moms och leverans inom Sverige.`)
  );
}

/** Lead text of a category page without its own description. */
export const categoryFallbackDescription = (name: string) =>
  `${name} för Pokémon TCG hos HeavyCards. Förseglade produkter med priser inklusive moms och leverans inom Sverige.`;

export function categorySeoTitle(category: {
  name: string;
  seoTitle: string | null;
}): string {
  return firstText(category.seoTitle) ?? `${category.name} – Pokémon TCG`;
}

export function categoryMetaDescription(category: {
  name: string;
  seoDescription: string | null;
  description: string | null;
}): string {
  return (
    firstText(category.seoDescription, category.description) ??
    categoryFallbackDescription(category.name)
  );
}

/** Lead text of a set page without its own description. */
export const setFallbackDescription = (name: string) =>
  `Förseglade produkter från Pokémon TCG-setet ${name} hos HeavyCards: booster boxes, Elite Trainer Boxes, booster packs och mer.`;

export function setSeoTitle(set: {
  name: string;
  seoTitle: string | null;
}): string {
  return firstText(set.seoTitle) ?? `${set.name} – Pokémon TCG-set`;
}

export function setMetaDescription(set: {
  name: string;
  seoDescription: string | null;
  description: string | null;
}): string {
  return (
    firstText(set.seoDescription, set.description) ??
    setFallbackDescription(set.name)
  );
}

/** Homepage title when store settings leave it blank (used as-is, no suffix). */
export const HOME_DEFAULT_TITLE = `${siteConfig.brandName} – Pokémon TCG i Sverige`;

export const HOME_DEFAULT_DESCRIPTION =
  "Förseglade Pokémon TCG-produkter: booster boxes, Elite Trainer Boxes, booster packs och mer. Priser inklusive moms och leverans inom Sverige.";

export function homeSeoTitle(settings: {
  defaultSeoTitle: string | null;
}): string {
  return firstText(settings.defaultSeoTitle) ?? HOME_DEFAULT_TITLE;
}

export function homeMetaDescription(settings: {
  defaultSeoDescription: string | null;
}): string {
  return firstText(settings.defaultSeoDescription) ?? HOME_DEFAULT_DESCRIPTION;
}
