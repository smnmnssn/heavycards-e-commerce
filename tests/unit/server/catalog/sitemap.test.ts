import { describe, expect, it } from "vitest";

import { infoPages } from "@/lib/config/info-pages";
import { buildSitemap } from "@/server/catalog/sitemap";
import type { SitemapData } from "@/server/data/catalog-queries";

const siteUrl = "https://heavycards.se";
const t1 = new Date("2026-09-01T10:00:00Z");
const t2 = new Date("2026-09-20T10:00:00Z");

const data = (overrides: Partial<SitemapData> = {}): SitemapData => ({
  products: [
    {
      slug: "destined-rivals-booster-box",
      updatedAt: t1,
      imageUrl: "https://store.public.blob.vercel-storage.com/products/a.webp",
    },
    { slug: "tin-utan-bild", updatedAt: t2, imageUrl: null },
  ],
  categories: [{ slug: "booster-boxes", lastModified: t2 }],
  sets: [{ slug: "destined-rivals", lastModified: t1 }],
  catalogUpdatedAt: t2,
  ...overrides,
});

describe("buildSitemap", () => {
  it("lists listings, landing pages and products as absolute canonical URLs", () => {
    expect(buildSitemap(siteUrl, data())).toEqual([
      { url: "https://heavycards.se/", lastModified: t2 },
      { url: "https://heavycards.se/pokemon-tcg", lastModified: t2 },
      { url: "https://heavycards.se/nyheter", lastModified: t2 },
      { url: "https://heavycards.se/kommande", lastModified: t2 },
      { url: "https://heavycards.se/kategori/booster-boxes", lastModified: t2 },
      { url: "https://heavycards.se/set/destined-rivals", lastModified: t1 },
      {
        url: "https://heavycards.se/pokemon-tcg/destined-rivals-booster-box",
        lastModified: t1,
        images: [
          "https://store.public.blob.vercel-storage.com/products/a.webp",
        ],
      },
      {
        url: "https://heavycards.se/pokemon-tcg/tin-utan-bild",
        lastModified: t2,
      },
    ]);
  });

  it("omits lastmod on listings while no product is listed", () => {
    const sitemap = buildSitemap(
      siteUrl,
      data({ products: [], categories: [], sets: [], catalogUpdatedAt: null }),
    );
    expect(sitemap).toEqual([
      { url: "https://heavycards.se/" },
      { url: "https://heavycards.se/pokemon-tcg" },
      { url: "https://heavycards.se/nyheter" },
      { url: "https://heavycards.se/kommande" },
    ]);
  });

  it("never lists private, search, filtered or placeholder pages", () => {
    const urls = buildSitemap(siteUrl, data()).map((entry) => entry.url);

    for (const url of urls) {
      expect(url).not.toMatch(/\/(admin|api|kassa|review|sok)(\/|$)/);
      expect(url).not.toContain("?");
    }
    // Information pages stay out until they are published (noindex today).
    for (const slug of Object.keys(infoPages)) {
      expect(urls).not.toContain(`${siteUrl}/${slug}`);
    }
  });
});
