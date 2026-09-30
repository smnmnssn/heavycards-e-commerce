import { describe, expect, it } from "vitest";

import {
  foldForSearch,
  hasFilterOrSort,
  listingHref,
  listingSeo,
  normalizeQuery,
  parseListingParams,
  searchTerms,
  type RawSearchParams,
} from "@/server/domain/catalog-params";

describe("parseListingParams", () => {
  it("parses valid Swedish parameters", () => {
    expect(
      parseListingParams({
        sortering: "pris-stigande",
        kategori: "booster-boxes",
        set: "destined-rivals",
        tillganglighet: "i-lager",
        sida: "2",
        q: "  destined   box ",
      }),
    ).toEqual({
      sort: "pris-stigande",
      categorySlug: "booster-boxes",
      setSlug: "destined-rivals",
      inStockOnly: true,
      page: 2,
      query: "destined box",
    });
  });

  it("drops invalid values instead of throwing", () => {
    expect(
      parseListingParams({
        sortering: "billigast",
        kategori: "../../etc",
        set: "Destined Rivals",
        tillganglighet: "yes",
        sida: "abc",
      }),
    ).toEqual({
      sort: undefined,
      categorySlug: undefined,
      setSlug: undefined,
      inStockOnly: false,
      page: 1,
      query: "",
    });
  });

  it.each(["0", "-1", "1.5", "501", "1e3"])("rejects page %j", (sida) => {
    expect(parseListingParams({ sida }).page).toBe(1);
  });

  it("uses the first value of repeated parameters", () => {
    expect(
      parseListingParams({ kategori: ["tins", "booster-boxes"] }).categorySlug,
    ).toBe("tins");
  });

  it("bounds the query length", () => {
    expect(parseListingParams({ q: "a".repeat(500) }).query).toHaveLength(100);
  });
});

describe("search terms", () => {
  it("splits, lowercases and drops one-letter words", () => {
    expect(searchTerms("Destined Rivals a Box")).toEqual([
      "destined",
      "rivals",
      "box",
    ]);
  });

  it("folds accented e but keeps å, ä, ö", () => {
    expect(foldForSearch("Pokémon Tillbehör Ålänning")).toBe(
      "pokemon tillbehör ålänning",
    );
  });

  it("keeps at most five terms", () => {
    expect(searchTerms("aa bb cc dd ee ff gg")).toHaveLength(5);
  });

  it("normalizes whitespace", () => {
    expect(normalizeQuery("  booster \n  box ")).toBe("booster box");
  });
});

describe("listingHref", () => {
  it("keeps only meaningful parameters in a stable order", () => {
    expect(
      listingHref("/pokemon-tcg", {
        sort: "nyast",
        page: 1,
        inStockOnly: false,
      }),
    ).toBe("/pokemon-tcg");
    expect(
      listingHref("/pokemon-tcg", {
        categorySlug: "tins",
        inStockOnly: true,
        sort: "pris-fallande",
        page: 3,
      }),
    ).toBe(
      "/pokemon-tcg?kategori=tins&tillganglighet=i-lager&sortering=pris-fallande&sida=3",
    );
  });

  it("omits the page-specific default sort (relevance on search)", () => {
    expect(
      listingHref("/sok", { query: "box", sort: "relevans" }, "relevans"),
    ).toBe("/sok?q=box");
    expect(
      listingHref("/sok", { query: "box", sort: "nyast" }, "relevans"),
    ).toBe("/sok?q=box&sortering=nyast");
  });
});

describe("listingSeo", () => {
  const params = (raw: RawSearchParams) => parseListingParams(raw);

  it("indexes the unfiltered listing with a self canonical", () => {
    expect(listingSeo("/pokemon-tcg", params({}))).toEqual({
      canonical: "/pokemon-tcg",
      index: true,
    });
    expect(listingSeo("/pokemon-tcg", params({ sida: "2" }))).toEqual({
      canonical: "/pokemon-tcg?sida=2",
      index: true,
    });
  });

  it.each([
    { kategori: "tins" },
    { set: "destined-rivals" },
    { tillganglighet: "i-lager" },
    { sortering: "pris-stigande" },
  ])("noindexes the variant %j and canonicalizes to the base", (raw) => {
    expect(listingSeo("/pokemon-tcg", params(raw))).toEqual({
      canonical: "/pokemon-tcg",
      index: false,
    });
    expect(hasFilterOrSort(params(raw))).toBe(true);
  });

  it("treats the default sort as unfiltered", () => {
    expect(
      listingSeo("/pokemon-tcg", params({ sortering: "nyast" })).index,
    ).toBe(true);
  });
});
