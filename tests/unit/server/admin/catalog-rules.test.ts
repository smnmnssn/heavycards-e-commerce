import { describe, expect, it } from "vitest";

import { canManageCatalog } from "@/lib/auth/authorization";
import {
  categoryMetaDescription,
  categorySeoTitle,
  productMetaDescription,
  productSeoTitle,
  setSeoTitle,
} from "@/lib/seo/catalog-defaults";
import {
  adminProductsHref,
  parseAdminProductParams,
  statusesFor,
} from "@/server/admin/catalog/product-list-params";
import { nextPublishedAt } from "@/server/admin/catalog/products";
import { catalogRevalidationTargets } from "@/server/admin/catalog/revalidation";
import {
  isPreorderPastRelease,
  productWarnings,
  stockLevel,
} from "@/server/domain/catalog-admin";

describe("catalog permissions", () => {
  it("lets both OWNER and ADMIN manage the catalog", () => {
    expect(canManageCatalog({ role: "OWNER" })).toBe(true);
    expect(canManageCatalog({ role: "ADMIN" })).toBe(true);
    expect(canManageCatalog({ role: "GUEST" as never })).toBe(false);
  });
});

describe("nextPublishedAt", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const earlier = new Date("2026-01-01T10:00:00Z");

  it("is set the first time a product becomes public", () => {
    expect(nextPublishedAt(null, "ACTIVE", now)).toEqual(now);
    expect(nextPublishedAt(null, "COMING_SOON", now)).toEqual(now);
  });

  it("stays unset for drafts and archived products never published", () => {
    expect(nextPublishedAt(null, "DRAFT", now)).toBeNull();
    expect(nextPublishedAt(null, "ARCHIVED", now)).toBeNull();
  });

  it("is never reset or moved once set", () => {
    for (const status of ["DRAFT", "ACTIVE", "ARCHIVED"] as const) {
      expect(nextPublishedAt(earlier, status, now)).toEqual(earlier);
    }
  });
});

describe("stock levels and preorder reminders", () => {
  it("uses the low-stock threshold on available quantity", () => {
    expect(stockLevel(0, 3)).toBe("out");
    expect(stockLevel(-2, 3)).toBe("out");
    expect(stockLevel(3, 3)).toBe("low");
    expect(stockLevel(4, 3)).toBe("ok");
    expect(stockLevel(1, 0)).toBe("ok");
  });

  it("flags preorders whose release date has passed, without changing them", () => {
    const today = "2026-10-01";
    expect(
      isPreorderPastRelease({ isPreorder: true, releaseDate: today }, today),
    ).toBe(true);
    expect(
      isPreorderPastRelease(
        { isPreorder: true, releaseDate: "2026-10-02" },
        today,
      ),
    ).toBe(false);
    expect(
      isPreorderPastRelease({ isPreorder: true, releaseDate: null }, today),
    ).toBe(false);
    expect(
      isPreorderPastRelease({ isPreorder: false, releaseDate: today }, today),
    ).toBe(false);
  });

  it("lists warnings for the edit page", () => {
    const warnings = productWarnings(
      {
        status: "ACTIVE",
        isPreorder: true,
        releaseDate: "2026-09-01",
        imageCount: 0,
        availableQuantity: 0,
      },
      "2026-10-01",
    );
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/förbeställning trots att släppdatumet/);
    expect(
      productWarnings(
        {
          status: "DRAFT",
          isPreorder: false,
          releaseDate: null,
          imageCount: 0,
          availableQuantity: 0,
        },
        "2026-10-01",
      ),
    ).toEqual([]);
  });
});

describe("admin product list parameters", () => {
  it("parses valid parameters and ignores invalid ones", () => {
    expect(
      parseAdminProductParams({
        q: "  booster ",
        status: "ARCHIVED",
        kategori: "01999999-0000-7000-8000-000000000001",
        set: "nope",
        lager: "lagt",
        sortering: "lager",
        sida: "2",
      }),
    ).toEqual({
      q: "booster",
      status: "ARCHIVED",
      categoryId: "01999999-0000-7000-8000-000000000001",
      setId: "",
      stock: "lagt",
      sort: "lager",
      page: 2,
    });
    expect(
      parseAdminProductParams({
        status: "SOLD_OUT",
        sida: "-1",
        sortering: ["x"],
      }),
    ).toMatchObject({ status: "", page: 1, sort: "namn" });
  });

  it("maps status filters to statuses (archived hidden by default)", () => {
    expect(statusesFor("")).toEqual(["DRAFT", "ACTIVE", "COMING_SOON"]);
    expect(statusesFor("publicerade")).toEqual(["ACTIVE", "COMING_SOON"]);
    expect(statusesFor("ARCHIVED")).toEqual(["ARCHIVED"]);
    expect(statusesFor("alla")).toBeNull();
  });

  it("builds list URLs that keep other filters", () => {
    const params = parseAdminProductParams({ q: "box", lager: "slut" });
    expect(adminProductsHref(params, { page: 3 })).toBe(
      "/admin/products?q=box&lager=slut&sida=3",
    );
    expect(adminProductsHref(parseAdminProductParams({}))).toBe(
      "/admin/products",
    );
  });
});

describe("catalogRevalidationTargets", () => {
  it("refreshes the homepage, listings and every product page", () => {
    const targets = catalogRevalidationTargets();
    expect(targets).toEqual(
      expect.arrayContaining([
        { path: "/" },
        { path: "/pokemon-tcg" },
        { path: "/nyheter" },
        { path: "/kommande" },
        { path: "/(store)/pokemon-tcg/[productSlug]", type: "page" },
        { path: "/(store)/kategori/[slug]", type: "page" },
        { path: "/(store)/set/[slug]", type: "page" },
      ]),
    );
    // Information pages keep their own cache.
    expect(targets.map((target) => target.path)).not.toContain("/om-oss");
    expect(targets).not.toContainEqual({ path: "/", type: "layout" });
  });

  it("also refreshes the old and new URL of a renamed product", () => {
    expect(catalogRevalidationTargets(["gammal", "ny"])).toEqual(
      expect.arrayContaining([
        { path: "/pokemon-tcg/gammal" },
        { path: "/pokemon-tcg/ny" },
      ]),
    );
  });
});

describe("SEO defaults shared by storefront and admin preview", () => {
  it("prefers stored values and falls back to generated text", () => {
    expect(productSeoTitle({ name: "Box", seoTitle: "  " })).toBe("Box");
    expect(productSeoTitle({ name: "Box", seoTitle: "Egen" })).toBe("Egen");
    expect(
      productMetaDescription({
        name: "Box",
        seoDescription: null,
        shortDescription: null,
        description: null,
        setName: "Destined Rivals",
      }),
    ).toBe(
      "Köp Box hos HeavyCards, från setet Destined Rivals. Priser inklusive moms och leverans inom Sverige.",
    );
    expect(categorySeoTitle({ name: "Tins", seoTitle: null })).toBe(
      "Tins – Pokémon TCG",
    );
    expect(
      categoryMetaDescription({
        name: "Tins",
        seoDescription: null,
        description: "Plåtaskar",
      }),
    ).toBe("Plåtaskar");
    expect(setSeoTitle({ name: "Destined Rivals", seoTitle: null })).toBe(
      "Destined Rivals – Pokémon TCG-set",
    );
  });
});
