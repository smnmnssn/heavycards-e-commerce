"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { storage } from "@/lib/storage/server";
import type { ProductFormValues } from "@/lib/validation/catalog";
import {
  asCatalogManager,
  INVALID_REQUEST_STATE,
  type CatalogActionError,
  type CatalogActionState,
} from "@/server/admin/catalog/action-guard";
import { productFormValues } from "@/server/admin/catalog/form-values";
import {
  removeProductImage,
  reorderProductImages,
  updateProductImageAlt,
} from "@/server/admin/catalog/product-images";
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "@/server/admin/catalog/products";
import { getAdminProduct } from "@/server/admin/catalog/queries";
import { revalidateCatalog } from "@/server/admin/catalog/revalidate";
import { PRODUCT_IMAGES_PER_PRODUCT_MAX } from "@/lib/validation/product-images";

/*
 * Product administration actions (OWNER and ADMIN). Each call authorizes on
 * the server (asCatalogManager) and validates every argument; the services
 * validate the form values again with the shared schema and re-check the
 * administrator inside their transaction.
 */

const idSchema = z.uuid();

const CHECK_FIELDS = "Kontrollera de markerade fälten.";
const PRODUCT_GONE: CatalogActionError = {
  status: "error",
  message: "Produkten finns inte längre.",
};

export type ProductSaveState =
  | CatalogActionError
  | {
      status: "success";
      message: string;
      values: ProductFormValues;
      stockOnHand: number;
    };

export async function createProductAction(
  values: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const result = await createProduct(db, {
      actorId: admin.id,
      input: values,
    });
    if (!result.ok) {
      return {
        status: "error",
        message: CHECK_FIELDS,
        fieldErrors: result.fieldErrors,
      };
    }
    revalidateCatalog(result.slugs);
    redirect(`/admin/products/${result.productId}?skapad=1`);
  });
}

export async function updateProductAction(
  productId: unknown,
  values: unknown,
  expectedStockOnHand: unknown,
): Promise<ProductSaveState> {
  return asCatalogManager(async (admin): Promise<ProductSaveState> => {
    const id = idSchema.safeParse(productId);
    const expected = z.number().int().min(0).safeParse(expectedStockOnHand);
    if (!id.success || !expected.success) return INVALID_REQUEST_STATE;

    const result = await updateProduct(db, {
      actorId: admin.id,
      productId: id.data,
      input: values,
      expectedStockOnHand: expected.data,
    });
    if (!result.ok) {
      switch (result.error) {
        case "NOT_FOUND":
          return PRODUCT_GONE;
        case "STOCK_CONFLICT":
          return {
            status: "error",
            message: `Lagersaldot har ändrats till ${result.currentStock} sedan sidan laddades. Ladda om sidan och gör ändringen igen.`,
            fieldErrors: {
              stockOnHand: `Ändrat av någon annan (nu ${result.currentStock}).`,
            },
          };
        case "INVALID_INPUT":
          return {
            status: "error",
            message: CHECK_FIELDS,
            fieldErrors: result.fieldErrors,
          };
      }
    }

    revalidateCatalog(result.slugs);
    refresh();
    const saved = await getAdminProduct(db, id.data, new Date());
    if (!saved) return PRODUCT_GONE;
    return {
      status: "success",
      message: result.redirectCreated
        ? "Produkten är sparad. Den gamla adressen leder nu permanent till den nya."
        : "Produkten är sparad.",
      values: productFormValues(saved),
      stockOnHand: saved.stockOnHand,
    };
  });
}

export async function deleteProductAction(
  productId: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const id = idSchema.safeParse(productId);
    if (!id.success) return INVALID_REQUEST_STATE;

    const result = await deleteProduct(db, storage, {
      actorId: admin.id,
      productId: id.data,
    });
    if (!result.ok) {
      const messages = {
        NOT_FOUND: "Produkten finns inte längre.",
        PUBLISHED:
          "Produkten har varit publicerad och kan inte raderas. Arkivera den i stället, så fortsätter gamla länkar att fungera.",
        HAS_HISTORY:
          "Produkten har ordrar, reservationer eller recensioner och kan inte raderas. Arkivera den i stället.",
      } as const;
      return { status: "error", message: messages[result.error] };
    }
    revalidateCatalog(result.slugs);
    redirect("/admin/products?raderad=1");
  });
}

// --- Images -----------------------------------------------------------------------

function imageResultState(
  result: Awaited<ReturnType<typeof removeProductImage>>,
  message: string,
): CatalogActionState {
  if (!result.ok) return { status: "error", message: result.message };
  revalidateCatalog(result.slugs);
  refresh();
  return { status: "success", message };
}

export async function updateProductImageAltAction(
  productId: unknown,
  imageId: unknown,
  altText: unknown,
): Promise<CatalogActionState> {
  return asCatalogManager(async (admin) => {
    const product = idSchema.safeParse(productId);
    const image = idSchema.safeParse(imageId);
    if (!product.success || !image.success || typeof altText !== "string") {
      return INVALID_REQUEST_STATE;
    }
    const result = await updateProductImageAlt(db, {
      actorId: admin.id,
      productId: product.data,
      imageId: image.data,
      altText,
    });
    return imageResultState(result, "Alt-texten är sparad.");
  });
}

export async function reorderProductImagesAction(
  productId: unknown,
  orderedIds: unknown,
): Promise<CatalogActionState> {
  return asCatalogManager(async (admin) => {
    const product = idSchema.safeParse(productId);
    const ids = z
      .array(z.uuid())
      .max(PRODUCT_IMAGES_PER_PRODUCT_MAX)
      .safeParse(orderedIds);
    if (!product.success || !ids.success) return INVALID_REQUEST_STATE;
    const result = await reorderProductImages(db, {
      actorId: admin.id,
      productId: product.data,
      orderedIds: ids.data,
    });
    return imageResultState(result, "Bildordningen är sparad.");
  });
}

export async function removeProductImageAction(
  productId: unknown,
  imageId: unknown,
): Promise<CatalogActionState> {
  return asCatalogManager(async (admin) => {
    const product = idSchema.safeParse(productId);
    const image = idSchema.safeParse(imageId);
    if (!product.success || !image.success) return INVALID_REQUEST_STATE;
    const result = await removeProductImage(db, storage, {
      actorId: admin.id,
      productId: product.data,
      imageId: image.data,
    });
    return imageResultState(result, "Bilden är borttagen.");
  });
}
