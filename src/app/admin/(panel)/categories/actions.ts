"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db/client";
import type { CategoryFormValues } from "@/lib/validation/catalog";
import {
  asCatalogManager,
  INVALID_REQUEST_STATE,
  type CatalogActionError,
} from "@/server/admin/catalog/action-guard";
import { categoryFormValues } from "@/server/admin/catalog/form-values";
import { getAdminCategory } from "@/server/admin/catalog/queries";
import { revalidateCatalog } from "@/server/admin/catalog/revalidate";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/server/admin/catalog/taxonomy";

/** Category administration (OWNER and ADMIN), authorized on every call. */

const idSchema = z.uuid();
const CHECK_FIELDS = "Kontrollera de markerade fälten.";
const GONE: CatalogActionError = {
  status: "error",
  message: "Kategorin finns inte längre.",
};

export type CategorySaveState =
  | CatalogActionError
  | { status: "success"; message: string; values: CategoryFormValues };

export async function createCategoryAction(
  values: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const result = await createCategory(db, {
      actorId: admin.id,
      input: values,
    });
    if (!result.ok) {
      if (result.error === "NOT_FOUND") return GONE;
      return {
        status: "error",
        message: CHECK_FIELDS,
        fieldErrors: result.fieldErrors,
      };
    }
    revalidateCatalog();
    redirect(`/admin/categories/${result.id}?skapad=1`);
  });
}

export async function updateCategoryAction(
  categoryId: unknown,
  values: unknown,
): Promise<CategorySaveState> {
  return asCatalogManager(async (admin): Promise<CategorySaveState> => {
    const id = idSchema.safeParse(categoryId);
    if (!id.success) return INVALID_REQUEST_STATE;
    const result = await updateCategory(db, {
      actorId: admin.id,
      id: id.data,
      input: values,
    });
    if (!result.ok) {
      if (result.error === "NOT_FOUND") return GONE;
      return {
        status: "error",
        message: CHECK_FIELDS,
        fieldErrors: result.fieldErrors,
      };
    }
    revalidateCatalog();
    refresh();
    const saved = await getAdminCategory(db, id.data);
    if (!saved) return GONE;
    return {
      status: "success",
      message: result.redirectCreated
        ? "Kategorin är sparad. Den gamla adressen leder nu permanent till den nya."
        : "Kategorin är sparad.",
      values: categoryFormValues(saved),
    };
  });
}

export async function deleteCategoryAction(
  categoryId: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const id = idSchema.safeParse(categoryId);
    if (!id.success) return INVALID_REQUEST_STATE;
    const result = await deleteCategory(db, { actorId: admin.id, id: id.data });
    if (!result.ok) {
      if (result.error === "NOT_FOUND") return GONE;
      return {
        status: "error",
        message: `Kategorin används av ${result.productCount} ${
          result.productCount === 1 ? "produkt" : "produkter"
        } (även utkast och arkiverade räknas) och kan inte tas bort. Flytta produkterna till en annan kategori först.`,
      };
    }
    revalidateCatalog();
    redirect("/admin/categories?raderad=1");
  });
}
