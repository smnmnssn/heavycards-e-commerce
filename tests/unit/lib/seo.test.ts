import { describe, expect, it } from "vitest";

import {
  formatIsoDate,
  formatInstantDate,
  stockholmToday,
  toIsoDate,
} from "@/lib/dates";
import {
  categoryMetaDescription,
  categorySeoTitle,
  HOME_DEFAULT_DESCRIPTION,
  HOME_DEFAULT_TITLE,
  homeMetaDescription,
  homeSeoTitle,
  productMetaDescription,
  productSeoTitle,
  setMetaDescription,
  setSeoTitle,
} from "@/lib/seo/catalog-defaults";
import {
  isIndexableDeployment,
  PRODUCTION_DISALLOW,
  robotsFor,
} from "@/lib/seo/indexing";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
  serializeJsonLd,
  storeIdentityJsonLd,
} from "@/lib/seo/json-ld";
import {
  DEFAULT_SHARE_IMAGE,
  excerpt,
  firstText,
  pagedTitle,
  pageMetadata,
} from "@/lib/seo/metadata";

describe("excerpt", () => {
  it("returns short text unchanged but whitespace-normalized", () => {
    expect(excerpt("  Kort\n text ")).toBe("Kort text");
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const text = "ord ".repeat(100);
    const result = excerpt(text, 50);

    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("ord…")).toBe(true);
  });
});

describe("firstText", () => {
  it("returns the first non-blank candidate", () => {
    expect(firstText(null, "  ", undefined, " SEO-titel ")).toBe("SEO-titel");
    expect(firstText(null, "")).toBeUndefined();
  });
});

describe("pageMetadata", () => {
  it("sets canonical, description and robots", () => {
    const metadata = pageMetadata({
      title: "Tins",
      description: "Beskrivning",
      path: "/kategori/tins",
      index: false,
    });

    expect(metadata).toMatchObject({
      title: "Tins",
      description: "Beskrivning",
      alternates: { canonical: "/kategori/tins" },
      robots: { index: false, follow: true },
      openGraph: { url: "/kategori/tins" },
    });
  });

  it("supports absolute titles and leaves indexable pages without robots", () => {
    const metadata = pageMetadata({
      title: "HeavyCards – Pokémon TCG",
      description: "x",
      path: "/",
      absoluteTitle: true,
    });

    expect(metadata.title).toEqual({ absolute: "HeavyCards – Pokémon TCG" });
    // The key must be absent, not undefined: Next.js would otherwise replace
    // a parent's robots with nothing.
    expect(Object.keys(metadata)).not.toContain("robots");
  });

  it("states the shared Open Graph fields on every page (Next.js replaces, never merges, openGraph)", () => {
    const metadata = pageMetadata({
      title: "Nyheter",
      description: "Nya produkter",
      path: "/nyheter",
    });

    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: "HeavyCards",
      locale: "sv_SE",
      title: "Nyheter",
      description: "Nya produkter",
      url: "/nyheter",
      images: [DEFAULT_SHARE_IMAGE],
    });
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
    expect(DEFAULT_SHARE_IMAGE).toMatchObject({ width: 1200, height: 630 });
  });

  it("uses product imagery instead of the brand image when given", () => {
    const image = {
      url: "https://cdn.example/products/a.webp",
      width: 1600,
      height: 1600,
      alt: "Destined Rivals Booster Box",
    };
    const metadata = pageMetadata({
      title: "Destined Rivals Booster Box",
      description: "x",
      path: "/pokemon-tcg/destined-rivals-booster-box",
      images: [image],
    });

    expect(metadata.openGraph).toMatchObject({ images: [image] });
    expect(metadata.twitter).toEqual({ card: "summary" });
  });

  it("cuts long descriptions to 160 characters", () => {
    const metadata = pageMetadata({
      title: "x",
      description: "ord ".repeat(100),
      path: "/x",
    });

    expect(String(metadata.description).length).toBeLessThanOrEqual(160);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("numbers titles of later listing pages", () => {
    expect(pagedTitle("Tins")).toBe("Tins");
    expect(pagedTitle("Tins", 1)).toBe("Tins");
    expect(pagedTitle("Tins", 3)).toBe("Tins – sida 3");
  });
});

describe("SEO defaults and overrides", () => {
  const product = {
    name: "Destined Rivals Booster Box",
    seoTitle: null,
    seoDescription: null,
    shortDescription: null,
    description: null,
    setName: "Destined Rivals",
  };

  it("derives product title and description when SEO fields are blank", () => {
    expect(productSeoTitle(product)).toBe("Destined Rivals Booster Box");
    expect(productMetaDescription(product)).toBe(
      "Köp Destined Rivals Booster Box hos HeavyCards, från setet Destined Rivals. Priser inklusive moms och leverans inom Sverige.",
    );
    expect(productMetaDescription({ ...product, setName: null })).toBe(
      "Köp Destined Rivals Booster Box hos HeavyCards. Priser inklusive moms och leverans inom Sverige.",
    );
  });

  it("falls back from short description to a description excerpt", () => {
    expect(
      productMetaDescription({
        ...product,
        shortDescription: "  36 boosterpaket.  ",
        description: "Lång text",
      }),
    ).toBe("36 boosterpaket.");
    const long = "Destined Rivals är ett set. ".repeat(20);
    const generated = productMetaDescription({ ...product, description: long });
    expect(generated.length).toBeLessThanOrEqual(160);
    expect(generated.startsWith("Destined Rivals är ett set.")).toBe(true);
  });

  it("lets manual SEO fields override every default", () => {
    const manual = {
      ...product,
      seoTitle: "  Köp Destined Rivals Booster Box  ",
      seoDescription: "Egen beskrivning.",
      shortDescription: "Kort",
    };
    expect(productSeoTitle(manual)).toBe("Köp Destined Rivals Booster Box");
    expect(productMetaDescription(manual)).toBe("Egen beskrivning.");
  });

  it("treats whitespace-only SEO fields as blank", () => {
    expect(productSeoTitle({ ...product, seoTitle: "   " })).toBe(product.name);
  });

  it("generates Swedish category and set defaults, overridden by SEO fields", () => {
    const category = {
      name: "Tins",
      seoTitle: null,
      seoDescription: null,
      description: null,
    };
    expect(categorySeoTitle(category)).toBe("Tins – Pokémon TCG");
    expect(categoryMetaDescription(category)).toContain(
      "Tins för Pokémon TCG hos HeavyCards",
    );
    expect(
      categoryMetaDescription({ ...category, description: "Plåtaskar." }),
    ).toBe("Plåtaskar.");
    expect(
      categorySeoTitle({ ...category, seoTitle: "Pokémon tins i plåtask" }),
    ).toBe("Pokémon tins i plåtask");

    const set = { ...category, name: "Destined Rivals" };
    expect(setSeoTitle(set)).toBe("Destined Rivals – Pokémon TCG-set");
    expect(setMetaDescription(set)).toContain(
      "Pokémon TCG-setet Destined Rivals",
    );
    expect(setMetaDescription({ ...set, seoDescription: "Egen." })).toBe(
      "Egen.",
    );
  });

  it("uses homepage store settings when set, defaults otherwise", () => {
    const blank = { defaultSeoTitle: null, defaultSeoDescription: "  " };
    expect(homeSeoTitle(blank)).toBe(HOME_DEFAULT_TITLE);
    expect(homeSeoTitle(blank)).toBe("HeavyCards – Pokémon TCG i Sverige");
    expect(homeMetaDescription(blank)).toBe(HOME_DEFAULT_DESCRIPTION);
    expect(
      homeSeoTitle({ defaultSeoTitle: "HeavyCards | Pokémonkort online" }),
    ).toBe("HeavyCards | Pokémonkort online");
    expect(
      homeMetaDescription({ defaultSeoDescription: "Svensk butik." }),
    ).toBe("Svensk butik.");
  });
});

describe("deployment indexing and robots.txt", () => {
  it("indexes only the Vercel production deployment", () => {
    expect(isIndexableDeployment("production")).toBe(true);
    for (const env of ["preview", "development", undefined, ""]) {
      expect(isIndexableDeployment(env)).toBe(false);
    }
  });

  it("lets production crawl the storefront and points at the sitemap", () => {
    const robots = robotsFor({
      indexable: true,
      siteUrl: "https://heavycards.se",
    });

    expect(robots).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
      sitemap: "https://heavycards.se/sitemap.xml",
    });
  });

  it("never blocks storefront content or the pages whose noindex must be seen", () => {
    for (const path of PRODUCTION_DISALLOW) {
      for (const open of [
        "/",
        "/pokemon-tcg",
        "/kategori",
        "/set",
        "/nyheter",
        "/kommande",
        "/review",
        "/kassa",
        "/sok",
        "/_next",
      ]) {
        expect(open.startsWith(path)).toBe(false);
      }
    }
  });

  it("disallows everything on previews, local and CI builds", () => {
    expect(
      robotsFor({
        indexable: false,
        siteUrl: "https://heavycards-git-x.vercel.app",
      }),
    ).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("JSON-LD", () => {
  it("escapes < so content cannot close the script tag", () => {
    const json = serializeJsonLd({ name: "</script><script>alert(1)" });

    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)");
  });

  it("escapes every character that could break out of the script element", () => {
    const separators = String.fromCharCode(0x2028, 0x2029);
    const hostile = `<!-- & --> </SCRIPT ${separators}`;
    const json = serializeJsonLd([{ reviewBody: hostile }]);

    expect(json).not.toMatch(/[<>&]/);
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(json).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(json)).toEqual([{ reviewBody: hostile }]);
  });

  it("describes the store as Organization and WebSite without unknown details", () => {
    const [organization, website] = storeIdentityJsonLd({
      siteUrl: "https://heavycards.se",
      logoPath: "/brand/heavycards-logo.png",
      legalName: null,
      email: null,
    });

    expect(organization).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": "https://heavycards.se/#organization",
      name: "HeavyCards",
      url: "https://heavycards.se/",
      logo: "https://heavycards.se/brand/heavycards-logo.png",
    });
    expect(website).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "https://heavycards.se/#website",
      name: "HeavyCards",
      url: "https://heavycards.se/",
      inLanguage: "sv-SE",
      publisher: { "@id": "https://heavycards.se/#organization" },
    });
  });

  it("adds the company name and contact email once they are configured", () => {
    const [organization] = storeIdentityJsonLd({
      siteUrl: "https://heavycards.se",
      logoPath: "/brand/heavycards-logo.png",
      legalName: "HeavyCards AB",
      email: "kundservice@heavycards.se",
    });

    expect(organization).toMatchObject({
      legalName: "HeavyCards AB",
      email: "kundservice@heavycards.se",
    });
  });

  it("lists a landing page's products in display order", () => {
    expect(
      collectionPageJsonLd({
        siteUrl: "https://heavycards.se",
        path: "/kategori/tins?sida=2",
        name: "Tins",
        description: "Plåtaskar.",
        numberOfItems: 26,
        offset: 24,
        items: [
          { name: "Tin A", href: "/pokemon-tcg/tin-a" },
          { name: "Tin B", href: "/pokemon-tcg/tin-b" },
        ],
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Tins",
      description: "Plåtaskar.",
      url: "https://heavycards.se/kategori/tins?sida=2",
      inLanguage: "sv-SE",
      isPartOf: { "@id": "https://heavycards.se/#website" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: 26,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 25,
            name: "Tin A",
            url: "https://heavycards.se/pokemon-tcg/tin-a",
          },
          {
            "@type": "ListItem",
            position: 26,
            name: "Tin B",
            url: "https://heavycards.se/pokemon-tcg/tin-b",
          },
        ],
      },
    });
  });

  it("builds absolute breadcrumb items; the current page has no link", () => {
    expect(
      breadcrumbJsonLd("https://heavycards.se", [
        { label: "Hem", href: "/" },
        { label: "Tins" },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Hem",
          item: "https://heavycards.se/",
        },
        { "@type": "ListItem", position: 2, name: "Tins" },
      ],
    });
  });
});

describe("dates", () => {
  it("uses the Swedish calendar date, not UTC", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Stockholm (UTC+2).
    expect(stockholmToday(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });

  it("round-trips Prisma date values without shifting a day", () => {
    const date = toIsoDate(new Date("2026-11-14T00:00:00Z"));

    expect(date).toBe("2026-11-14");
    expect(formatIsoDate(date)).toBe("14 november 2026");
  });

  it("formats instants in Swedish", () => {
    expect(formatInstantDate(new Date("2026-05-30T12:00:00Z"))).toBe(
      "30 maj 2026",
    );
  });
});
