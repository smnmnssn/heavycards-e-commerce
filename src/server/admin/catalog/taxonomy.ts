import { CATALOG_ROOT_PATH, categoryPath, setPath } from "@/lib/catalog-paths";
import { toIsoDate } from "@/lib/dates";
import {
  categoryFormSchema,
  fieldErrorsFrom,
  pokemonSetFormSchema,
} from "@/lib/validation/catalog";
import { recordPathChange, releasePath } from "@/server/catalog/redirects";

import {
  assertCatalogManager,
  AUDIT_ENTITY,
  CATALOG_AUDIT_ACTIONS,
  changedFields,
  invalidInput,
  isForeignKeyViolation,
  isUniqueViolation,
  lockRow,
  UUID_PATTERN,
  writeAudit,
  type InvalidInput,
  type PrismaClient,
} from "./shared";

/*
 * Categories and Pokémon sets (PROJECT.md §15, §16). Both always have a
 * public landing page, so:
 * - a slug change always redirects the old URL to the new one;
 * - deleting one redirects its URL to the catalog root, so an indexed URL
 *   never silently becomes a 404;
 * - deletion is refused while any product (including drafts and archived
 *   products) references it. The RESTRICT foreign key is the final guard.
 */

export type TaxonomyChange = { slugs: string[] };

export type SaveTaxonomyResult =
  | ({ ok: true; id: string; redirectCreated: boolean } & TaxonomyChange)
  | InvalidInput
  | { ok: false; error: "NOT_FOUND" };

export type DeleteTaxonomyResult =
  | ({ ok: true } & TaxonomyChange)
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "IN_USE"; productCount: number };

const SLUG_TAKEN = {
  slug: "Sluggen används redan. Välj en annan.",
};

const calendarDate = (isoDate: string | null) =>
  isoDate ? new Date(`${isoDate}T00:00:00Z`) : null;

// --- Categories -----------------------------------------------------------------

export async function createCategory(
  db: PrismaClient,
  { actorId, input }: { actorId: string; input: unknown },
): Promise<SaveTaxonomyResult> {
  const parsed = categoryFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      const created = await tx.category.create({
        data: values,
        select: { id: true },
      });
      await releasePath(tx, categoryPath(values.slug));
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.categoryCreated,
        entityType: AUDIT_ENTITY.category,
        entityId: created.id,
        metadata: { name: values.name, slug: values.slug },
      });
      return {
        ok: true as const,
        id: created.id,
        redirectCreated: false,
        slugs: [values.slug],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(SLUG_TAKEN);
    throw error;
  }
}

export async function updateCategory(
  db: PrismaClient,
  { actorId, id, input }: { actorId: string; id: string; input: unknown },
): Promise<SaveTaxonomyResult> {
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "NOT_FOUND" };
  const parsed = categoryFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockRow(tx, "categories", id))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const current = await tx.category.findUniqueOrThrow({ where: { id } });
      const slugOwner = await tx.category.findUnique({
        where: { slug: values.slug },
        select: { id: true },
      });
      if (slugOwner && slugOwner.id !== id) return invalidInput(SLUG_TAKEN);

      await tx.category.update({ where: { id }, data: values });
      const redirectCreated = current.slug !== values.slug;
      if (redirectCreated) {
        await recordPathChange(
          tx,
          categoryPath(current.slug),
          categoryPath(values.slug),
        );
        await writeAudit(tx, {
          actorId,
          action: CATALOG_AUDIT_ACTIONS.categorySlugChanged,
          entityType: AUDIT_ENTITY.category,
          entityId: id,
          metadata: {
            slug: { from: current.slug, to: values.slug },
            redirect: {
              from: categoryPath(current.slug),
              to: categoryPath(values.slug),
            },
          },
        });
      }
      const changes = changedFields(
        current,
        values,
        ["name", "sortOrder", "description", "seoTitle", "seoDescription"],
        { textOnly: ["description", "seoDescription"] },
      );
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, {
          actorId,
          action: CATALOG_AUDIT_ACTIONS.categoryUpdated,
          entityType: AUDIT_ENTITY.category,
          entityId: id,
          metadata: { slug: values.slug, changes },
        });
      }
      return {
        ok: true as const,
        id,
        redirectCreated,
        slugs: [...new Set([current.slug, values.slug])],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(SLUG_TAKEN);
    throw error;
  }
}

export async function deleteCategory(
  db: PrismaClient,
  { actorId, id }: { actorId: string; id: string },
): Promise<DeleteTaxonomyResult> {
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "NOT_FOUND" };
  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockRow(tx, "categories", id))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const category = await tx.category.findUniqueOrThrow({
        where: { id },
        select: {
          name: true,
          slug: true,
          _count: { select: { products: true } },
        },
      });
      if (category._count.products > 0) {
        return {
          ok: false as const,
          error: "IN_USE" as const,
          productCount: category._count.products,
        };
      }
      await tx.category.delete({ where: { id } });
      await recordPathChange(
        tx,
        categoryPath(category.slug),
        CATALOG_ROOT_PATH,
      );
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.categoryDeleted,
        entityType: AUDIT_ENTITY.category,
        entityId: id,
        metadata: {
          name: category.name,
          slug: category.slug,
          redirect: {
            from: categoryPath(category.slug),
            to: CATALOG_ROOT_PATH,
          },
        },
      });
      return { ok: true as const, slugs: [category.slug] };
    });
  } catch (error) {
    // A product was assigned concurrently; the foreign key refused the delete.
    if (isForeignKeyViolation(error)) {
      return { ok: false, error: "IN_USE", productCount: 1 };
    }
    throw error;
  }
}

// --- Pokémon sets ---------------------------------------------------------------

const setData = (values: ReturnType<typeof pokemonSetFormSchema.parse>) => ({
  ...values,
  releaseDate: calendarDate(values.releaseDate),
});

export async function createPokemonSet(
  db: PrismaClient,
  { actorId, input }: { actorId: string; input: unknown },
): Promise<SaveTaxonomyResult> {
  const parsed = pokemonSetFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      const created = await tx.pokemonSet.create({
        data: setData(values),
        select: { id: true },
      });
      await releasePath(tx, setPath(values.slug));
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.setCreated,
        entityType: AUDIT_ENTITY.pokemonSet,
        entityId: created.id,
        metadata: { name: values.name, slug: values.slug },
      });
      return {
        ok: true as const,
        id: created.id,
        redirectCreated: false,
        slugs: [values.slug],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(SLUG_TAKEN);
    throw error;
  }
}

export async function updatePokemonSet(
  db: PrismaClient,
  { actorId, id, input }: { actorId: string; id: string; input: unknown },
): Promise<SaveTaxonomyResult> {
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "NOT_FOUND" };
  const parsed = pokemonSetFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockRow(tx, "pokemon_sets", id))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const current = await tx.pokemonSet.findUniqueOrThrow({ where: { id } });
      const slugOwner = await tx.pokemonSet.findUnique({
        where: { slug: values.slug },
        select: { id: true },
      });
      if (slugOwner && slugOwner.id !== id) return invalidInput(SLUG_TAKEN);

      await tx.pokemonSet.update({ where: { id }, data: setData(values) });
      const redirectCreated = current.slug !== values.slug;
      if (redirectCreated) {
        await recordPathChange(tx, setPath(current.slug), setPath(values.slug));
        await writeAudit(tx, {
          actorId,
          action: CATALOG_AUDIT_ACTIONS.setSlugChanged,
          entityType: AUDIT_ENTITY.pokemonSet,
          entityId: id,
          metadata: {
            slug: { from: current.slug, to: values.slug },
            redirect: { from: setPath(current.slug), to: setPath(values.slug) },
          },
        });
      }
      const changes = changedFields(
        {
          ...current,
          releaseDate: current.releaseDate
            ? toIsoDate(current.releaseDate)
            : null,
        },
        values,
        ["name", "releaseDate", "description", "seoTitle", "seoDescription"],
        { textOnly: ["description", "seoDescription"] },
      );
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, {
          actorId,
          action: CATALOG_AUDIT_ACTIONS.setUpdated,
          entityType: AUDIT_ENTITY.pokemonSet,
          entityId: id,
          metadata: { slug: values.slug, changes },
        });
      }
      return {
        ok: true as const,
        id,
        redirectCreated,
        slugs: [...new Set([current.slug, values.slug])],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(SLUG_TAKEN);
    throw error;
  }
}

export async function deletePokemonSet(
  db: PrismaClient,
  { actorId, id }: { actorId: string; id: string },
): Promise<DeleteTaxonomyResult> {
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "NOT_FOUND" };
  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockRow(tx, "pokemon_sets", id))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const set = await tx.pokemonSet.findUniqueOrThrow({
        where: { id },
        select: {
          name: true,
          slug: true,
          _count: { select: { products: true } },
        },
      });
      if (set._count.products > 0) {
        return {
          ok: false as const,
          error: "IN_USE" as const,
          productCount: set._count.products,
        };
      }
      await tx.pokemonSet.delete({ where: { id } });
      await recordPathChange(tx, setPath(set.slug), CATALOG_ROOT_PATH);
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.setDeleted,
        entityType: AUDIT_ENTITY.pokemonSet,
        entityId: id,
        metadata: {
          name: set.name,
          slug: set.slug,
          redirect: { from: setPath(set.slug), to: CATALOG_ROOT_PATH },
        },
      });
      return { ok: true as const, slugs: [set.slug] };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return { ok: false, error: "IN_USE", productCount: 1 };
    }
    throw error;
  }
}
