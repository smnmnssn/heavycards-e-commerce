import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import type {
  CategoryFormValues,
  PokemonSetFormValues,
} from "@/lib/validation/catalog";
import {
  createCategory,
  createPokemonSet,
  deleteCategory,
  deletePokemonSet,
  updateCategory,
  updatePokemonSet,
} from "@/server/admin/catalog/taxonomy";
import { findRedirectDestination } from "@/server/catalog/redirects";
import {
  getCategoryBySlug,
  getSetBySlug,
  listCategories,
} from "@/server/data/catalog-queries";

import { createAdmin } from "./auth-helpers";
import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const categoryForm = (
  overrides: Partial<CategoryFormValues> = {},
): CategoryFormValues => ({
  name: "Booster Boxes",
  slug: "booster-boxes",
  description: "Hela displayer.",
  sortOrder: "1",
  seoTitle: "",
  seoDescription: "",
  ...overrides,
});

const setForm = (
  overrides: Partial<PokemonSetFormValues> = {},
): PokemonSetFormValues => ({
  name: "Destined Rivals",
  slug: "destined-rivals",
  description: "",
  releaseDate: "2025-05-30",
  seoTitle: "",
  seoDescription: "",
  ...overrides,
});

async function ok<T extends { ok: boolean }>(promise: Promise<T>) {
  const result = await promise;
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

describe("categories", () => {
  it.each(["OWNER", "ADMIN"] as const)(
    "lets an %s create and edit a category with audit entries",
    async (role) => {
      const actor = await createAdmin(db, { role });
      const { id } = await ok(
        createCategory(db, { actorId: actor.id, input: categoryForm() }),
      );

      await ok(
        updateCategory(db, {
          actorId: actor.id,
          id,
          input: categoryForm({
            name: "Booster-displayer",
            sortOrder: "5",
            seoTitle: "Köp booster boxes",
            description: "Ny text.",
          }),
        }),
      );

      expect(
        await db.category.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        name: "Booster-displayer",
        sortOrder: 5,
        seoTitle: "Köp booster boxes",
        seoDescription: null,
      });
      const audit = await db.auditLog.findMany({
        where: { entityId: id },
        orderBy: { createdAt: "asc" },
      });
      expect(audit.map((entry) => [entry.action, entry.adminUserId])).toEqual([
        ["CREATE_CATEGORY", actor.id],
        ["UPDATE_CATEGORY", actor.id],
      ]);
      expect(audit[1]!.metadata).toMatchObject({
        changes: {
          name: { from: "Booster Boxes", to: "Booster-displayer" },
          sortOrder: { from: 1, to: 5 },
          description: { changed: true },
        },
      });
    },
  );

  it("orders categories by display order on the storefront", async () => {
    const admin = await createAdmin(db);
    await ok(
      createCategory(db, {
        actorId: admin.id,
        input: categoryForm({ name: "B", slug: "b", sortOrder: "2" }),
      }),
    );
    await ok(
      createCategory(db, {
        actorId: admin.id,
        input: categoryForm({ name: "A", slug: "a", sortOrder: "9" }),
      }),
    );
    await ok(
      createCategory(db, {
        actorId: admin.id,
        input: categoryForm({ name: "C", slug: "c", sortOrder: "-1" }),
      }),
    );

    expect((await listCategories(db, new Date())).map((c) => c.name)).toEqual([
      "C",
      "B",
      "A",
    ]);
  });

  it("rejects a duplicate slug on the slug field", async () => {
    const admin = await createAdmin(db);
    await ok(createCategory(db, { actorId: admin.id, input: categoryForm() }));
    const other = await ok(
      createCategory(db, {
        actorId: admin.id,
        input: categoryForm({ name: "Tins", slug: "tins" }),
      }),
    );

    expect(
      await createCategory(db, { actorId: admin.id, input: categoryForm() }),
    ).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    expect(
      await updateCategory(db, {
        actorId: admin.id,
        id: other.id,
        input: categoryForm({ name: "Tins" }),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
  });

  it("redirects the old URL when the slug changes", async () => {
    const admin = await createAdmin(db);
    const { id } = await ok(
      createCategory(db, { actorId: admin.id, input: categoryForm() }),
    );

    expect(
      await updateCategory(db, {
        actorId: admin.id,
        id,
        input: categoryForm({ slug: "displayer" }),
      }),
    ).toMatchObject({ ok: true, redirectCreated: true });

    expect(await getCategoryBySlug(db, "booster-boxes", new Date())).toBeNull();
    expect(await findRedirectDestination(db, "/kategori/booster-boxes")).toBe(
      "/kategori/displayer",
    );
    expect(
      await db.auditLog.findFirst({
        where: { entityId: id, action: "CHANGE_CATEGORY_SLUG" },
      }),
    ).not.toBeNull();
  });

  it("cannot delete a category used by any product, even archived ones", async () => {
    const admin = await createAdmin(db);
    const { id } = await ok(
      createCategory(db, { actorId: admin.id, input: categoryForm() }),
    );
    await createProduct(db, { categoryId: id, status: "ARCHIVED" });
    await createProduct(db, { categoryId: id, status: "DRAFT" });

    expect(await deleteCategory(db, { actorId: admin.id, id })).toEqual({
      ok: false,
      error: "IN_USE",
      productCount: 2,
    });
    expect(await db.category.count()).toBe(1);
  });

  it("deletes an unused category and sends its URL to the catalog root", async () => {
    const admin = await createAdmin(db);
    const { id } = await ok(
      createCategory(db, { actorId: admin.id, input: categoryForm() }),
    );

    await ok(deleteCategory(db, { actorId: admin.id, id }));

    expect(await db.category.count()).toBe(0);
    expect(await findRedirectDestination(db, "/kategori/booster-boxes")).toBe(
      "/pokemon-tcg",
    );
    expect(
      await db.auditLog.findFirst({ where: { action: "DELETE_CATEGORY" } }),
    ).toMatchObject({ entityId: id, adminUserId: admin.id });

    // Reusing the slug makes the URL live again.
    await ok(createCategory(db, { actorId: admin.id, input: categoryForm() }));
    expect(
      await findRedirectDestination(db, "/kategori/booster-boxes"),
    ).toBeNull();
  });

  it("refuses an inactive administrator", async () => {
    const inactive = await createAdmin(db, { isActive: false });
    await expect(
      createCategory(db, { actorId: inactive.id, input: categoryForm() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Pokémon sets", () => {
  it("creates and edits a set with release date and SEO fields", async () => {
    const admin = await createAdmin(db);
    const { id } = await ok(
      createPokemonSet(db, { actorId: admin.id, input: setForm() }),
    );

    await ok(
      updatePokemonSet(db, {
        actorId: admin.id,
        id,
        input: setForm({
          releaseDate: "2025-06-06",
          seoDescription: "Allt från Destined Rivals.",
        }),
      }),
    );

    expect(await getSetBySlug(db, "destined-rivals", new Date())).toMatchObject(
      {
        releaseDate: "2025-06-06",
        seoDescription: "Allt från Destined Rivals.",
      },
    );
    expect(
      (
        await db.auditLog.findFirstOrThrow({
          where: { entityId: id, action: "UPDATE_POKEMON_SET" },
        })
      ).metadata,
    ).toMatchObject({
      changes: { releaseDate: { from: "2025-05-30", to: "2025-06-06" } },
    });
  });

  it("redirects the old set URL after a slug change", async () => {
    const admin = await createAdmin(db);
    const { id } = await ok(
      createPokemonSet(db, { actorId: admin.id, input: setForm() }),
    );
    await ok(
      updatePokemonSet(db, {
        actorId: admin.id,
        id,
        input: setForm({ slug: "sv10-destined-rivals" }),
      }),
    );
    expect(await findRedirectDestination(db, "/set/destined-rivals")).toBe(
      "/set/sv10-destined-rivals",
    );
  });

  it("cannot delete a set used by products; an unused one is deleted", async () => {
    const admin = await createAdmin(db);
    const used = await ok(
      createPokemonSet(db, { actorId: admin.id, input: setForm() }),
    );
    await createProduct(db, { pokemonSetId: used.id });
    const unused = await ok(
      createPokemonSet(db, {
        actorId: admin.id,
        input: setForm({ name: "Mega", slug: "mega" }),
      }),
    );

    expect(
      await deletePokemonSet(db, { actorId: admin.id, id: used.id }),
    ).toEqual({ ok: false, error: "IN_USE", productCount: 1 });
    await ok(deletePokemonSet(db, { actorId: admin.id, id: unused.id }));
    expect(await db.pokemonSet.findMany({ select: { slug: true } })).toEqual([
      { slug: "destined-rivals" },
    ]);
    expect(await findRedirectDestination(db, "/set/mega")).toBe("/pokemon-tcg");
  });

  it("validates input on the server", async () => {
    const admin = await createAdmin(db);
    expect(
      await createPokemonSet(db, {
        actorId: admin.id,
        input: setForm({
          name: "",
          slug: "Ogiltig Slug",
          releaseDate: "2025-02-31",
        }),
      }),
    ).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: {
        name: expect.any(String),
        slug: expect.any(String),
        releaseDate: expect.any(String),
      },
    });
    expect(await db.pokemonSet.count()).toBe(0);
  });
});
