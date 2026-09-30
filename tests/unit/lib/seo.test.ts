import { describe, expect, it } from "vitest";

import {
  formatIsoDate,
  formatInstantDate,
  stockholmToday,
  toIsoDate,
} from "@/lib/dates";
import { breadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { excerpt, firstText, pageMetadata } from "@/lib/seo/metadata";

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
    expect(metadata.robots).toBeUndefined();
  });
});

describe("JSON-LD", () => {
  it("escapes < so content cannot close the script tag", () => {
    const json = serializeJsonLd({ name: "</script><script>alert(1)" });

    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)");
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
