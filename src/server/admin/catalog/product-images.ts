import { productImageKey } from "@/lib/storage/keys";
import {
  StorageNotConfiguredError,
  type ObjectStorage,
} from "@/lib/storage/types";
import { imageAltSchema } from "@/lib/validation/catalog";
import { PRODUCT_IMAGES_PER_PRODUCT_MAX } from "@/lib/validation/product-images";
import { processProductImage } from "@/server/media/product-image";

import { deleteStoredObjects, type ProductChange } from "./products";
import {
  assertCatalogManager,
  AUDIT_ENTITY,
  CATALOG_AUDIT_ACTIONS,
  lockProduct,
  UUID_PATTERN,
  writeAudit,
  type PrismaClient,
  type Tx,
} from "./shared";

/*
 * Product images (PROJECT.md §14). Rows hold the storage key, public URL,
 * alt text, position and the stored file's pixel size. Positions are kept
 * contiguous (0, 1, 2, …); position 0 is the primary image. Every change
 * locks the product row, so concurrent uploads and reorders cannot produce
 * duplicate positions.
 */

export type ImageChangeResult =
  | ({ ok: true } & ProductChange)
  | { ok: false; error: "NOT_FOUND" | "INVALID_INPUT"; message: string };

const notFound = (message = "Produkten finns inte.") =>
  ({ ok: false, error: "NOT_FOUND", message }) as const;

async function productChange(
  tx: Tx,
  productId: string,
): Promise<ProductChange> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { slug: true },
  });
  return { productId, slugs: [product.slug] };
}

/** Rewrites positions to 0…n−1 in the given order. */
async function writePositions(tx: Tx, orderedIds: readonly string[]) {
  for (const [position, id] of orderedIds.entries()) {
    await tx.productImage.update({ where: { id }, data: { position } });
  }
}

// --- Upload -----------------------------------------------------------------------

export type UploadImageResult =
  | ({
      ok: true;
      image: { id: string; url: string; width: number; height: number };
    } & ProductChange)
  | {
      ok: false;
      error: "NOT_FOUND" | "INVALID_FILE" | "LIMIT" | "STORAGE";
      message: string;
    };

/**
 * Validates and normalises an uploaded file, stores it, then records it as
 * the product's last image. If the database step fails, the stored object
 * is deleted again so storage never accumulates unreferenced uploads.
 */
export async function uploadProductImage(
  db: PrismaClient,
  storage: ObjectStorage,
  {
    actorId,
    productId,
    file,
  }: {
    actorId: string;
    productId: string;
    file: { bytes: Uint8Array; type: string; name: string };
  },
): Promise<UploadImageResult> {
  if (!UUID_PATTERN.test(productId)) return notFound();

  // Cheap checks first, so nothing is processed or stored for a request
  // that cannot succeed.
  const precheck = await db.$transaction(async (tx) => {
    await assertCatalogManager(tx, actorId);
    return tx.product.findUnique({
      where: { id: productId },
      select: { _count: { select: { images: true } } },
    });
  });
  if (!precheck) return notFound();
  if (precheck._count.images >= PRODUCT_IMAGES_PER_PRODUCT_MAX) {
    return limitReached();
  }

  const processed = await processProductImage({
    bytes: file.bytes,
    declaredType: file.type,
    fileName: file.name,
  });
  if (!processed.ok) {
    return { ok: false, error: "INVALID_FILE", message: processed.message };
  }
  const { image } = processed;

  const storageKey = productImageKey(productId, image.extension);
  let url: string;
  try {
    ({ url } = await storage.put(storageKey, image.body, image.contentType));
  } catch (error) {
    console.error(
      `[storage] product image upload failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return {
      ok: false,
      error: "STORAGE",
      message:
        error instanceof StorageNotConfiguredError
          ? "Bildlagringen är inte konfigurerad i den här miljön (BLOB_READ_WRITE_TOKEN saknas). Kontakta utvecklaren."
          : "Bilden kunde inte sparas i bildlagringen. Försök igen om en stund.",
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await assertCatalogManager(tx, actorId);
      if (!(await lockProduct(tx, productId))) return null;
      const count = await tx.productImage.count({ where: { productId } });
      if (count >= PRODUCT_IMAGES_PER_PRODUCT_MAX) return "LIMIT" as const;

      const created = await tx.productImage.create({
        data: {
          productId,
          storageKey,
          url,
          position: count,
          width: image.width,
          height: image.height,
        },
        select: { id: true, url: true, width: true, height: true },
      });
      await writeAudit(tx, {
        actorId,
        action: CATALOG_AUDIT_ACTIONS.imageAdded,
        entityType: AUDIT_ENTITY.product,
        entityId: productId,
        metadata: {
          imageId: created.id,
          position: count,
          width: image.width,
          height: image.height,
        },
      });
      return { created, change: await productChange(tx, productId) };
    });

    if (result === null || result === "LIMIT") {
      await deleteStoredObjects(storage, [storageKey]);
      return result === null ? notFound() : limitReached();
    }
    return { ok: true, image: result.created, ...result.change };
  } catch (error) {
    await deleteStoredObjects(storage, [storageKey]);
    throw error;
  }
}

const limitReached = () =>
  ({
    ok: false,
    error: "LIMIT",
    message: `En produkt kan ha högst ${PRODUCT_IMAGES_PER_PRODUCT_MAX} bilder. Ta bort en bild först.`,
  }) as const;

// --- Alt text ---------------------------------------------------------------------

export async function updateProductImageAlt(
  db: PrismaClient,
  {
    actorId,
    productId,
    imageId,
    altText,
  }: { actorId: string; productId: string; imageId: string; altText: unknown },
): Promise<ImageChangeResult> {
  if (!UUID_PATTERN.test(productId) || !UUID_PATTERN.test(imageId)) {
    return notFound("Bilden finns inte.");
  }
  const parsed = imageAltSchema.safeParse(
    typeof altText === "string" ? altText : "",
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Ogiltig alt-text.",
    };
  }

  return db.$transaction(async (tx) => {
    await assertCatalogManager(tx, actorId);
    const updated = await tx.productImage.updateMany({
      where: { id: imageId, productId },
      data: { altText: parsed.data },
    });
    if (updated.count === 0) return notFound("Bilden finns inte.");
    await writeAudit(tx, {
      actorId,
      action: CATALOG_AUDIT_ACTIONS.imageAltUpdated,
      entityType: AUDIT_ENTITY.product,
      entityId: productId,
      metadata: { imageId, altText: parsed.data },
    });
    return { ok: true as const, ...(await productChange(tx, productId)) };
  });
}

// --- Reorder ----------------------------------------------------------------------

/**
 * Sets the image order. `orderedIds` must contain exactly the product's
 * images; anything else (a stale page, a tampered request) is rejected
 * rather than partially applied.
 */
export async function reorderProductImages(
  db: PrismaClient,
  {
    actorId,
    productId,
    orderedIds,
  }: { actorId: string; productId: string; orderedIds: readonly string[] },
): Promise<ImageChangeResult> {
  if (!UUID_PATTERN.test(productId)) return notFound();

  return db.$transaction(async (tx) => {
    await assertCatalogManager(tx, actorId);
    if (!(await lockProduct(tx, productId))) return notFound();
    const images = await tx.productImage.findMany({
      where: { productId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const current = images.map((image) => image.id);
    const sameSet =
      orderedIds.length === current.length &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => current.includes(id));
    if (!sameSet) {
      return {
        ok: false as const,
        error: "INVALID_INPUT" as const,
        message: "Bilderna har ändrats. Ladda om sidan och försök igen.",
      };
    }
    if (orderedIds.every((id, index) => id === current[index])) {
      return { ok: true as const, ...(await productChange(tx, productId)) };
    }

    await writePositions(tx, orderedIds);
    await writeAudit(tx, {
      actorId,
      action: CATALOG_AUDIT_ACTIONS.imagesReordered,
      entityType: AUDIT_ENTITY.product,
      entityId: productId,
      metadata: { from: current, to: [...orderedIds] },
    });
    return { ok: true as const, ...(await productChange(tx, productId)) };
  });
}

// --- Remove -----------------------------------------------------------------------

/** Removes an image row, closes the position gap, then deletes the file. */
export async function removeProductImage(
  db: PrismaClient,
  storage: ObjectStorage,
  {
    actorId,
    productId,
    imageId,
  }: { actorId: string; productId: string; imageId: string },
): Promise<ImageChangeResult> {
  if (!UUID_PATTERN.test(productId) || !UUID_PATTERN.test(imageId)) {
    return notFound("Bilden finns inte.");
  }
  let storageKey: string | null = null;
  const result = await db.$transaction(async (tx) => {
    await assertCatalogManager(tx, actorId);
    if (!(await lockProduct(tx, productId))) return notFound();
    const image = await tx.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true, storageKey: true, position: true },
    });
    if (!image) return notFound("Bilden finns inte.");

    await tx.productImage.delete({ where: { id: image.id } });
    const remaining = await tx.productImage.findMany({
      where: { productId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    await writePositions(
      tx,
      remaining.map((row) => row.id),
    );
    await writeAudit(tx, {
      actorId,
      action: CATALOG_AUDIT_ACTIONS.imageRemoved,
      entityType: AUDIT_ENTITY.product,
      entityId: productId,
      metadata: { imageId: image.id, position: image.position },
    });
    storageKey = image.storageKey;
    return { ok: true as const, ...(await productChange(tx, productId)) };
  });

  if (result.ok && storageKey) await deleteStoredObjects(storage, [storageKey]);
  return result;
}
