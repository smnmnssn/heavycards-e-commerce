import { z } from "zod";

import { ProductStatus } from "@/generated/prisma/enums";

/*
 * Query parameters of /admin/products. Parsed leniently: an invalid value is
 * ignored rather than rejected, like the storefront listings.
 */

export const ADMIN_PRODUCTS_PAGE_SIZE = 50;

export const ADMIN_STATUS_FILTERS = {
  "": "Alla utom arkiverade",
  publicerade: "Publicerade (aktiva och kommande)",
  DRAFT: "Utkast",
  ACTIVE: "Aktiva",
  COMING_SOON: "Kommer snart",
  ARCHIVED: "Arkiverade",
  alla: "Alla",
} as const;
export type AdminStatusFilter = keyof typeof ADMIN_STATUS_FILTERS;

export const ADMIN_STOCK_FILTERS = {
  "": "Alla lagernivåer",
  lagt: "Lågt lager (inkl. slut)",
  slut: "Slut i lager",
} as const;
export type AdminStockFilter = keyof typeof ADMIN_STOCK_FILTERS;

export const ADMIN_SORTS = {
  namn: "Namn (A–Ö)",
  andrad: "Senast ändrad",
  lager: "Tillgängligt (lägst först)",
} as const;
export type AdminSort = keyof typeof ADMIN_SORTS;

export type AdminProductListParams = {
  q: string;
  status: AdminStatusFilter;
  categoryId: string;
  setId: string;
  stock: AdminStockFilter;
  sort: AdminSort;
  page: number;
};

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const text = (max: number) =>
  z.preprocess(first, z.string().trim().max(max)).catch("");
const oneOf = <T extends string>(values: readonly T[], fallback: T) =>
  z.preprocess(first, z.enum(values as [T, ...T[]])).catch(fallback);

const schema = z.object({
  q: text(100),
  status: oneOf(Object.keys(ADMIN_STATUS_FILTERS) as AdminStatusFilter[], ""),
  kategori: z.preprocess(first, z.uuid()).catch(""),
  set: z.preprocess(first, z.uuid()).catch(""),
  lager: oneOf(Object.keys(ADMIN_STOCK_FILTERS) as AdminStockFilter[], ""),
  sortering: oneOf(Object.keys(ADMIN_SORTS) as AdminSort[], "namn"),
  sida: z.preprocess(first, z.coerce.number().int().min(1).max(1_000)).catch(1),
});

export function parseAdminProductParams(
  searchParams: Record<string, string | string[] | undefined>,
): AdminProductListParams {
  const parsed = schema.parse(searchParams);
  return {
    q: parsed.q,
    status: parsed.status,
    categoryId: parsed.kategori,
    setId: parsed.set,
    stock: parsed.lager,
    sort: parsed.sortering,
    page: parsed.sida,
  };
}

/** Statuses a filter selects; null means "no status condition". */
export function statusesFor(
  filter: AdminStatusFilter,
): readonly (typeof ProductStatus)[keyof typeof ProductStatus][] | null {
  if (filter === "alla") return null;
  if (filter === "") return ["DRAFT", "ACTIVE", "COMING_SOON"];
  if (filter === "publicerade") return ["ACTIVE", "COMING_SOON"];
  return [filter];
}

/** Builds a list URL that keeps the other filters. */
export function adminProductsHref(
  params: AdminProductListParams,
  overrides: Partial<AdminProductListParams> = {},
): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.status) query.set("status", merged.status);
  if (merged.categoryId) query.set("kategori", merged.categoryId);
  if (merged.setId) query.set("set", merged.setId);
  if (merged.stock) query.set("lager", merged.stock);
  if (merged.sort !== "namn") query.set("sortering", merged.sort);
  if (merged.page > 1) query.set("sida", String(merged.page));
  const search = query.toString();
  return search ? `/admin/products?${search}` : "/admin/products";
}
