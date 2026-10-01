import {
  Prisma,
  type AdminRole,
  type PrismaClient,
} from "@/generated/prisma/client";
import { canManageCatalog, ForbiddenError } from "@/lib/auth/authorization";
import type { FieldErrors } from "@/lib/validation/catalog";

export type Tx = Prisma.TransactionClient;
export type { PrismaClient };

/**
 * Audit actions for catalog administration (PROJECT.md §56). Metadata holds
 * old and new values for prices, stock, status and slugs; long texts are
 * only marked as changed.
 */
export const CATALOG_AUDIT_ACTIONS = {
  productCreated: "CREATE_PRODUCT",
  productUpdated: "UPDATE_PRODUCT",
  productPriceUpdated: "UPDATE_PRODUCT_PRICE",
  productStockUpdated: "UPDATE_PRODUCT_STOCK",
  productStatusUpdated: "UPDATE_PRODUCT_STATUS",
  productPublished: "PUBLISH_PRODUCT",
  productArchived: "ARCHIVE_PRODUCT",
  productSlugChanged: "CHANGE_PRODUCT_SLUG",
  productDeleted: "DELETE_PRODUCT",
  imageAdded: "ADD_PRODUCT_IMAGE",
  imageRemoved: "REMOVE_PRODUCT_IMAGE",
  imagesReordered: "REORDER_PRODUCT_IMAGES",
  imageAltUpdated: "UPDATE_PRODUCT_IMAGE_ALT",
  categoryCreated: "CREATE_CATEGORY",
  categoryUpdated: "UPDATE_CATEGORY",
  categorySlugChanged: "CHANGE_CATEGORY_SLUG",
  categoryDeleted: "DELETE_CATEGORY",
  setCreated: "CREATE_POKEMON_SET",
  setUpdated: "UPDATE_POKEMON_SET",
  setSlugChanged: "CHANGE_POKEMON_SET_SLUG",
  setDeleted: "DELETE_POKEMON_SET",
} as const;

export const AUDIT_ENTITY = {
  product: "Product",
  category: "Category",
  pokemonSet: "PokemonSet",
} as const;

export async function writeAudit(
  tx: Tx,
  entry: {
    actorId: string;
    action: (typeof CATALOG_AUDIT_ACTIONS)[keyof typeof CATALOG_AUDIT_ACTIONS];
    entityType: (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];
    entityId: string;
    metadata: Prisma.InputJsonObject;
  },
) {
  await tx.auditLog.create({
    data: {
      adminUserId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}

/**
 * Re-checks the acting administrator inside the write transaction. The
 * server action already checked the session, but the account may have been
 * deactivated since. `FOR SHARE` keeps it from being deactivated until this
 * transaction commits.
 */
export async function assertCatalogManager(tx: Tx, actorId: string) {
  const [actor] = await tx.$queryRaw<
    Array<{ role: AdminRole; isActive: boolean }>
  >`
    SELECT role::text AS role, is_active AS "isActive"
    FROM admin_users WHERE id = ${actorId}::uuid
    FOR SHARE
  `;
  if (!actor?.isActive || !canManageCatalog(actor)) {
    throw new ForbiddenError("Behörighet saknas för katalogen.");
  }
}

/** Serialises concurrent changes to one product (stock, slug, images). */
export async function lockProduct(tx: Tx, productId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM products WHERE id = ${productId}::uuid FOR UPDATE
  `;
  return rows.length > 0;
}

export async function lockRow(
  tx: Tx,
  table: "categories" | "pokemon_sets",
  id: string,
) {
  const rows =
    table === "categories"
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM categories WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM pokemon_sets WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export { isUniqueViolation } from "@/server/db/transactions";

export const isForeignKeyViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2003";

export type InvalidInput = {
  ok: false;
  error: "INVALID_INPUT";
  fieldErrors: FieldErrors;
};

export const invalidInput = (fieldErrors: FieldErrors): InvalidInput => ({
  ok: false,
  error: "INVALID_INPUT",
  fieldErrors,
});

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field-level change record for audit metadata. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: ReadonlyArray<keyof T & string>,
  { textOnly = [] }: { textOnly?: ReadonlyArray<keyof T & string> } = {},
): Prisma.InputJsonObject {
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const field of fields) {
    const from = normalizeForCompare(before[field]);
    const to = normalizeForCompare(after[field]);
    if (from === to) continue;
    changes[field] = textOnly.includes(field)
      ? { changed: true }
      : { from: from ?? null, to: to ?? null };
  }
  return changes as Prisma.InputJsonObject;
}

function normalizeForCompare(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}
