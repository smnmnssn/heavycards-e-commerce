import type { ProductStatus } from "@/generated/prisma/client";
import { productPath } from "@/lib/catalog-paths";
import { toIsoDate } from "@/lib/dates";
import { isManagedImageKey } from "@/lib/storage/keys";
import type { ObjectStorage } from "@/lib/storage/types";
import {
  fieldErrorsFrom,
  productFormSchema,
  type FieldErrors,
  type ProductInput,
} from "@/lib/validation/catalog";
import { recordPathChange, releasePath } from "@/server/catalog/redirects";
import { logSafe } from "@/server/logging/safe-log";

import {
  assertCatalogManager,
  AUDIT_ENTITY,
  CATALOG_AUDIT_ACTIONS,
  changedFields,
  invalidInput,
  isForeignKeyViolation,
  isUniqueViolation,
  lockProduct,
  UUID_PATTERN,
  writeAudit,
  type InvalidInput,
  type PrismaClient,
  type Tx,
} from "./shared";

/*
 * Product administration (PROJECT.md §53, §78). Every function:
 * - validates untrusted input with the shared Zod schema (authoritative);
 * - re-checks the acting administrator inside its transaction;
 * - writes audit entries in the same transaction as the change.
 */

const PUBLIC_STATUSES: readonly ProductStatus[] = ["ACTIVE", "COMING_SOON"];
export const isPublicStatus = (status: ProductStatus) =>
  PUBLIC_STATUSES.includes(status);

/**
 * `publishedAt` records the first time a product became public and is never
 * reset (it drives "Nyheter" and tells whether the URL has been public).
 */
export function nextPublishedAt(
  current: Date | null,
  status: ProductStatus,
  now: Date,
): Date | null {
  return current ?? (isPublicStatus(status) ? now : null);
}

const calendarDate = (isoDate: string | null) =>
  isoDate ? new Date(`${isoDate}T00:00:00Z`) : null;

function toProductData(input: ProductInput) {
  return {
    name: input.name,
    slug: input.slug,
    shortDescription: input.shortDescription,
    description: input.description,
    productType: input.productType,
    categoryId: input.categoryId,
    pokemonSetId: input.pokemonSetId,
    priceAmount: input.price,
    compareAtPriceAmount: input.compareAtPrice,
    sku: input.sku,
    status: input.status,
    isPreorder: input.isPreorder,
    isFeatured: input.isFeatured,
    releaseDate: calendarDate(input.releaseDate),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  };
}

/** Taxonomy and uniqueness checks the schema cannot do on its own. */
async function referenceErrors(
  tx: Tx,
  input: ProductInput,
  productId: string | null,
): Promise<FieldErrors> {
  // Sequential: a transaction runs on one connection, which must not be
  // given concurrent queries.
  const category = await tx.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  const set = input.pokemonSetId
    ? await tx.pokemonSet.findUnique({
        where: { id: input.pokemonSetId },
        select: { id: true },
      })
    : null;
  const slugOwner = await tx.product.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  const skuOwner = await tx.product.findUnique({
    where: { sku: input.sku },
    select: { id: true },
  });
  const errors: FieldErrors = {};
  if (!category) errors.categoryId = "Kategorin finns inte längre.";
  if (input.pokemonSetId && !set) {
    errors.pokemonSetId = "Setet finns inte längre.";
  }
  if (slugOwner && slugOwner.id !== productId) {
    errors.slug = "Sluggen används redan av en annan produkt.";
  }
  if (skuOwner && skuOwner.id !== productId) {
    errors.sku = "Artikelnumret används redan av en annan produkt.";
  }
  return errors;
}

/** Shown when a concurrent save wins a unique-constraint race. */
const CONFLICT_ERRORS: FieldErrors = {
  slug: "Sluggen eller artikelnumret används redan. Kontrollera och försök igen.",
};

/** Data needed to refresh cached storefront pages after a change. */
export type ProductChange = { productId: string; slugs: string[] };

// --- Create -----------------------------------------------------------------------

export type CreateProductResult = ({ ok: true } & ProductChange) | InvalidInput;

export async function createProduct(
  db: PrismaClient,
  {
    actorId,
    input,
    now = new Date(),
  }: { actorId: string; input: unknown; now?: Date },
): Promise<CreateProductResult> {
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      const errors = await referenceErrors(tx, values, null);
      if (Object.keys(errors).length > 0) return invalidInput(errors);

      const publishedAt = nextPublishedAt(null, values.status, now);
      const product = await tx.product.create({
        data: {
          ...toProductData(values),
          stockOnHand: values.stockOnHand,
          publishedAt,
        },
        select: { id: true },
      });
      if (publishedAt) await releasePath(tx, productPath(values.slug));

      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.productCreated,
        entityType: AUDIT_ENTITY.product,
        entityId: product.id,
        metadata: {
          name: values.name,
          sku: values.sku,
          slug: values.slug,
          status: values.status,
          priceAmount: values.price,
          stockOnHand: values.stockOnHand,
        },
      });
      return {
        ok: true as const,
        productId: product.id,
        slugs: [values.slug],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(CONFLICT_ERRORS);
    if (isForeignKeyViolation(error)) {
      return invalidInput({ categoryId: "Kategorin eller setet finns inte." });
    }
    throw error;
  }
}

// --- Update -----------------------------------------------------------------------

export type UpdateProductResult =
  | ({ ok: true; redirectCreated: boolean } & ProductChange)
  | InvalidInput
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "STOCK_CONFLICT"; currentStock: number };

/**
 * Saves the product form. Stock uses compare-and-set: `expectedStockOnHand`
 * is the value the administrator's form was loaded with. If stock changed in
 * the meantime (another administrator, or a sale), a stock edit is refused
 * instead of silently overwriting it; an untouched stock field is left alone.
 * Other fields are last-write-wins.
 */
export async function updateProduct(
  db: PrismaClient,
  {
    actorId,
    productId,
    input,
    expectedStockOnHand,
    now = new Date(),
  }: {
    actorId: string;
    productId: string;
    input: unknown;
    expectedStockOnHand: number;
    now?: Date;
  },
): Promise<UpdateProductResult> {
  if (!UUID_PATTERN.test(productId)) return { ok: false, error: "NOT_FOUND" };
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput(fieldErrorsFrom(parsed.error));
  const values = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockProduct(tx, productId))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const current = await tx.product.findUniqueOrThrow({
        where: { id: productId },
      });

      const stockChanged = values.stockOnHand !== current.stockOnHand;
      if (stockChanged && expectedStockOnHand !== current.stockOnHand) {
        return {
          ok: false as const,
          error: "STOCK_CONFLICT" as const,
          currentStock: current.stockOnHand,
        };
      }
      const errors = await referenceErrors(tx, values, productId);
      if (Object.keys(errors).length > 0) return invalidInput(errors);

      const data = toProductData(values);
      const publishedAt = nextPublishedAt(
        current.publishedAt,
        values.status,
        now,
      );
      await tx.product.update({
        where: { id: productId },
        data: {
          ...data,
          publishedAt,
          ...(stockChanged ? { stockOnHand: values.stockOnHand } : {}),
        },
      });

      // A URL that has been public keeps working after a slug change.
      const slugChanged = current.slug !== values.slug;
      const redirectCreated = slugChanged && current.publishedAt !== null;
      if (redirectCreated) {
        await recordPathChange(
          tx,
          productPath(current.slug),
          productPath(values.slug),
        );
      } else if (publishedAt) {
        await releasePath(tx, productPath(values.slug));
      }

      await auditProductUpdate(tx, {
        actorId,
        productId,
        current,
        next: { ...data, stockOnHand: values.stockOnHand },
        redirectCreated,
      });

      return {
        ok: true as const,
        redirectCreated,
        productId,
        slugs: [...new Set([current.slug, values.slug])],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return invalidInput(CONFLICT_ERRORS);
    if (isForeignKeyViolation(error)) {
      return invalidInput({ categoryId: "Kategorin eller setet finns inte." });
    }
    throw error;
  }
}

type ProductRow = Awaited<ReturnType<Tx["product"]["findUniqueOrThrow"]>>;

/** One audit entry per kind of change, with old and new values (§56). */
async function auditProductUpdate(
  tx: Tx,
  {
    actorId,
    productId,
    current,
    next,
    redirectCreated,
  }: {
    actorId: string;
    productId: string;
    current: ProductRow;
    next: ReturnType<typeof toProductData> & { stockOnHand: number };
    redirectCreated: boolean;
  },
) {
  const entry = (
    action: (typeof CATALOG_AUDIT_ACTIONS)[keyof typeof CATALOG_AUDIT_ACTIONS],
    metadata: Parameters<typeof writeAudit>[1]["metadata"],
  ) =>
    writeAudit(tx, {
      actorId,
      action,
      entityType: AUDIT_ENTITY.product,
      entityId: productId,
      metadata: { sku: next.sku, ...metadata },
    });

  if (
    current.priceAmount !== next.priceAmount ||
    current.compareAtPriceAmount !== next.compareAtPriceAmount
  ) {
    await entry(CATALOG_AUDIT_ACTIONS.productPriceUpdated, {
      priceAmount: { from: current.priceAmount, to: next.priceAmount },
      compareAtPriceAmount: {
        from: current.compareAtPriceAmount,
        to: next.compareAtPriceAmount,
      },
    });
  }
  if (current.stockOnHand !== next.stockOnHand) {
    await entry(CATALOG_AUDIT_ACTIONS.productStockUpdated, {
      stockOnHand: { from: current.stockOnHand, to: next.stockOnHand },
    });
  }
  if (current.status !== next.status) {
    const action =
      next.status === "ARCHIVED"
        ? CATALOG_AUDIT_ACTIONS.productArchived
        : isPublicStatus(next.status) && !isPublicStatus(current.status)
          ? CATALOG_AUDIT_ACTIONS.productPublished
          : CATALOG_AUDIT_ACTIONS.productStatusUpdated;
    await entry(action, { status: { from: current.status, to: next.status } });
  }
  if (current.slug !== next.slug) {
    await entry(CATALOG_AUDIT_ACTIONS.productSlugChanged, {
      slug: { from: current.slug, to: next.slug },
      redirect: redirectCreated
        ? { from: productPath(current.slug), to: productPath(next.slug) }
        : null,
    });
  }

  const before = {
    ...current,
    releaseDate: current.releaseDate ? toIsoDate(current.releaseDate) : null,
  };
  const after = {
    ...next,
    releaseDate: next.releaseDate ? toIsoDate(next.releaseDate) : null,
  };
  const changes = changedFields(
    before,
    after,
    [
      "name",
      "sku",
      "productType",
      "categoryId",
      "pokemonSetId",
      "isFeatured",
      "isPreorder",
      "releaseDate",
      "shortDescription",
      "description",
      "seoTitle",
      "seoDescription",
    ],
    { textOnly: ["shortDescription", "description", "seoDescription"] },
  );
  if (Object.keys(changes).length > 0) {
    await entry(CATALOG_AUDIT_ACTIONS.productUpdated, { changes });
  }
}

// --- Delete -----------------------------------------------------------------------

export type DeleteProductResult =
  | ({ ok: true } & ProductChange)
  | { ok: false; error: "NOT_FOUND" | "PUBLISHED" | "HAS_HISTORY" };

/**
 * Permanently deletes a product, which is only allowed for products that
 * were never public and have no orders, reservations or reviews (e.g. a
 * draft created by mistake). Everything else must be archived, so order
 * history and established URLs stay intact (PROJECT.md §53). The database's
 * RESTRICT foreign keys are the final safeguard.
 */
export async function deleteProduct(
  db: PrismaClient,
  storage: ObjectStorage,
  { actorId, productId }: { actorId: string; productId: string },
): Promise<DeleteProductResult> {
  if (!UUID_PATTERN.test(productId)) return { ok: false, error: "NOT_FOUND" };
  let result: DeleteProductResult;
  let storageKeys: string[] = [];
  try {
    result = await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockProduct(tx, productId))) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: {
          name: true,
          sku: true,
          slug: true,
          publishedAt: true,
          images: { select: { storageKey: true } },
          _count: {
            select: { orderItems: true, reservations: true, reviews: true },
          },
        },
      });
      if (product.publishedAt) {
        return { ok: false as const, error: "PUBLISHED" as const };
      }
      const { orderItems, reservations, reviews } = product._count;
      if (orderItems + reservations + reviews > 0) {
        return { ok: false as const, error: "HAS_HISTORY" as const };
      }

      await tx.product.delete({ where: { id: productId } });
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.productDeleted,
        entityType: AUDIT_ENTITY.product,
        entityId: productId,
        metadata: { name: product.name, sku: product.sku, slug: product.slug },
      });
      storageKeys = product.images.map((image) => image.storageKey);
      return {
        ok: true as const,
        productId,
        slugs: [product.slug],
      };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return { ok: false, error: "HAS_HISTORY" };
    }
    throw error;
  }

  if (result.ok) await deleteStoredObjects(storage, storageKeys);
  return result;
}

/**
 * Removes stored image files after the database change has committed. A
 * failure only leaves an unreferenced file behind, never a broken image, so
 * it is logged and not raised. The log names the keys (server-generated
 * `products/<uuid>/<uuid>.<ext>` paths of public product photos; no tokens
 * or personal data) so an operator can delete them by hand
 * (docs/production-readiness.md → Storage); the provider error is reduced
 * to its name, since its message could contain a URL with a token.
 */
export async function deleteStoredObjects(
  storage: ObjectStorage,
  keys: readonly string[],
) {
  const managed = keys.filter(isManagedImageKey);
  if (managed.length === 0) return;
  try {
    await storage.delete(managed);
  } catch (error) {
    logSafe("storage", "error", "product image objects could not be deleted", {
      keys: managed,
      error,
    });
  }
}
