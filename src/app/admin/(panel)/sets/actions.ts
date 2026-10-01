"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db/client";
import type { PokemonSetFormValues } from "@/lib/validation/catalog";
import {
  asCatalogManager,
  INVALID_REQUEST_STATE,
  type CatalogActionError,
} from "@/server/admin/catalog/action-guard";
import { pokemonSetFormValues } from "@/server/admin/catalog/form-values";
import { getAdminSet } from "@/server/admin/catalog/queries";
import { revalidateCatalog } from "@/server/admin/catalog/revalidate";
import {
  createPokemonSet,
  deletePokemonSet,
  updatePokemonSet,
} from "@/server/admin/catalog/taxonomy";

/** Pokémon set administration (OWNER and ADMIN), authorized on every call. */

const idSchema = z.uuid();
const CHECK_FIELDS = "Kontrollera de markerade fälten.";
const GONE: CatalogActionError = {
  status: "error",
  message: "Setet finns inte längre.",
};

export type PokemonSetSaveState =
  | CatalogActionError
  | { status: "success"; message: string; values: PokemonSetFormValues };

export async function createPokemonSetAction(
  values: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const result = await createPokemonSet(db, {
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
    redirect(`/admin/sets/${result.id}?skapad=1`);
  });
}

export async function updatePokemonSetAction(
  setId: unknown,
  values: unknown,
): Promise<PokemonSetSaveState> {
  return asCatalogManager(async (admin): Promise<PokemonSetSaveState> => {
    const id = idSchema.safeParse(setId);
    if (!id.success) return INVALID_REQUEST_STATE;
    const result = await updatePokemonSet(db, {
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
    const saved = await getAdminSet(db, id.data);
    if (!saved) return GONE;
    return {
      status: "success",
      message: result.redirectCreated
        ? "Setet är sparat. Den gamla adressen leder nu permanent till den nya."
        : "Setet är sparat.",
      values: pokemonSetFormValues(saved),
    };
  });
}

export async function deletePokemonSetAction(
  setId: unknown,
): Promise<CatalogActionError> {
  return asCatalogManager(async (admin) => {
    const id = idSchema.safeParse(setId);
    if (!id.success) return INVALID_REQUEST_STATE;
    const result = await deletePokemonSet(db, {
      actorId: admin.id,
      id: id.data,
    });
    if (!result.ok) {
      if (result.error === "NOT_FOUND") return GONE;
      return {
        status: "error",
        message: `Setet används av ${result.productCount} ${
          result.productCount === 1 ? "produkt" : "produkter"
        } (även utkast och arkiverade räknas) och kan inte tas bort. Ta bort setet från produkterna först.`,
      };
    }
    revalidateCatalog();
    redirect("/admin/sets?raderad=1");
  });
}
