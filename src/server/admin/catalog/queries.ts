import {
  Prisma,
  type PrismaClient,
  type ProductStatus,
  type ProductType,
} from "@/generated/prisma/client";
import { toIsoDate, type IsoDate } from "@/lib/dates";

import {
  ADMIN_PRODUCTS_PAGE_SIZE,
  statusesFor,
  type AdminProductListParams,
  type AdminSort,
} from "./product-list-params";
import {
  holdingReservationSql,
  holdingReservationWhere,
} from "@/server/data/reservations";

/*
 * Read queries for the admin catalog. Like the storefront queries they take
 * the Prisma client explicitly, so DB tests run exactly this code.
 */

// --- Product list -----------------------------------------------------------------

export type AdminProductRow = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  status: ProductStatus;
  isPreorder: boolean;
  isFeatured: boolean;
  releaseDate: IsoDate | null;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  stockOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  categoryName: string;
  setName: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type AdminProductList = {
  rows: AdminProductRow[];
  total: number;
  page: number;
  pageCount: number;
};

const likePattern = (term: string) =>
  `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const orderBy: Record<AdminSort, Prisma.Sql> = {
  namn: Prisma.sql`lower(p.name) ASC, p.id ASC`,
  andrad: Prisma.sql`p.updated_at DESC, p.id DESC`,
  lager: Prisma.sql`available ASC, lower(p.name) ASC, p.id ASC`,
};

type ListRow = Omit<
  AdminProductRow,
  "availableQuantity" | "reservedQuantity"
> & {
  reserved: number;
  available: number;
  totalCount: number;
};

/**
 * One page of products for /admin/products. Availability (stock on hand
 * minus active, unexpired reservations) is computed in SQL with the same
 * rule as the storefront, so the low-stock filter, sorting and paging agree.
 */
export async function listAdminProducts(
  client: PrismaClient,
  {
    params,
    lowStockThreshold,
    now,
    pageSize = ADMIN_PRODUCTS_PAGE_SIZE,
  }: {
    params: AdminProductListParams;
    lowStockThreshold: number;
    now: Date;
    pageSize?: number;
  },
): Promise<AdminProductList> {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  const statuses = statusesFor(params.status);
  if (statuses) {
    conditions.push(
      Prisma.sql`p.status::text IN (${Prisma.join([...statuses])})`,
    );
  }
  if (params.categoryId) {
    conditions.push(Prisma.sql`p.category_id = ${params.categoryId}::uuid`);
  }
  if (params.setId) {
    conditions.push(Prisma.sql`p.pokemon_set_id = ${params.setId}::uuid`);
  }
  for (const term of params.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
    const pattern = likePattern(term.toLowerCase());
    conditions.push(
      Prisma.sql`(lower(p.name) LIKE ${pattern} ESCAPE '\\' OR lower(p.sku) LIKE ${pattern} ESCAPE '\\' OR p.slug LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (params.stock === "slut") {
    conditions.push(Prisma.sql`p.stock_on_hand - res.reserved <= 0`);
  } else if (params.stock === "lagt") {
    conditions.push(
      Prisma.sql`p.stock_on_hand - res.reserved <= ${lowStockThreshold}`,
    );
  }
  const where = Prisma.join(conditions, " AND ");

  const fetchPage = (page: number) => client.$queryRaw<ListRow[]>`
    SELECT
      p.id::text AS "id",
      p.name,
      p.slug,
      p.sku,
      p.status::text AS "status",
      p.is_preorder AS "isPreorder",
      p.is_featured AS "isFeatured",
      to_char(p.release_date, 'YYYY-MM-DD') AS "releaseDate",
      p.price_amount AS "priceAmount",
      p.compare_at_price_amount AS "compareAtPriceAmount",
      p.stock_on_hand AS "stockOnHand",
      res.reserved,
      GREATEST(p.stock_on_hand - res.reserved, 0)::int AS available,
      c.name AS "categoryName",
      s.name AS "setName",
      img.url AS "imageUrl",
      p.published_at AS "publishedAt",
      p.updated_at AS "updatedAt",
      count(*) OVER ()::int AS "totalCount"
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN pokemon_sets s ON s.id = p.pokemon_set_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r.quantity), 0)::int AS reserved
      FROM inventory_reservations r
      WHERE r.product_id = p.id AND ${holdingReservationSql(now)}
    ) res ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.url FROM product_images i
      WHERE i.product_id = p.id
      ORDER BY i.position ASC, i.created_at ASC
      LIMIT 1
    ) img ON TRUE
    WHERE ${where}
    ORDER BY ${orderBy[params.sort]}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `;

  let page = params.page;
  let rows = await fetchPage(page);
  // A page past the end (e.g. after filtering) falls back to the last page.
  if (rows.length === 0 && page > 1) {
    const [{ total }] = await client.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total
      FROM products p
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(r.quantity), 0)::int AS reserved
        FROM inventory_reservations r
        WHERE r.product_id = p.id AND ${holdingReservationSql(now)}
      ) res ON TRUE
      WHERE ${where}
    `;
    page = Math.max(1, Math.ceil(total / pageSize));
    rows = total > 0 ? await fetchPage(page) : [];
  }

  const total = rows[0]?.totalCount ?? 0;
  return {
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      status: row.status,
      isPreorder: row.isPreorder,
      isFeatured: row.isFeatured,
      releaseDate: row.releaseDate,
      priceAmount: row.priceAmount,
      compareAtPriceAmount: row.compareAtPriceAmount,
      stockOnHand: row.stockOnHand,
      reservedQuantity: row.reserved,
      availableQuantity: row.available,
      categoryName: row.categoryName,
      setName: row.setName,
      imageUrl: row.imageUrl,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    })),
  };
}

// --- Product detail ---------------------------------------------------------------

export type AdminProductDetail = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  description: string | null;
  productType: ProductType;
  status: ProductStatus;
  categoryId: string;
  pokemonSetId: string | null;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  stockOnHand: number;
  reservedQuantity: number;
  isPreorder: boolean;
  isFeatured: boolean;
  releaseDate: IsoDate | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { name: string; slug: string };
  pokemonSet: { name: string; slug: string } | null;
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    width: number;
    height: number;
    position: number;
  }>;
  history: { orderItems: number; reservations: number; reviews: number };
};

export async function getAdminProduct(
  client: PrismaClient,
  id: string,
  now: Date,
): Promise<AdminProductDetail | null> {
  const product = await client.product.findUnique({
    where: { id },
    include: {
      category: { select: { name: true, slug: true } },
      pokemonSet: { select: { name: true, slug: true } },
      images: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          url: true,
          altText: true,
          width: true,
          height: true,
          position: true,
        },
      },
      _count: {
        select: { orderItems: true, reservations: true, reviews: true },
      },
    },
  });
  if (!product) return null;

  const reserved = await client.inventoryReservation.aggregate({
    where: { productId: id, ...holdingReservationWhere(now) },
    _sum: { quantity: true },
  });
  const { _count, releaseDate, ...rest } = product;
  return {
    ...rest,
    releaseDate: releaseDate ? toIsoDate(releaseDate) : null,
    reservedQuantity: reserved._sum.quantity ?? 0,
    history: _count,
  };
}

// --- Taxonomy -------------------------------------------------------------------

export type TaxonomyOption = { id: string; name: string };

/** Choices for the product form's category and set selects. */
export async function catalogOptions(client: PrismaClient) {
  const [categories, sets] = await Promise.all([
    client.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    client.pokemonSet.findMany({
      orderBy: [
        { releaseDate: { sort: "desc", nulls: "last" } },
        { name: "asc" },
      ],
      select: { id: true, name: true },
    }),
  ]);
  return { categories, sets };
}

export type AdminCategoryRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  updatedAt: Date;
};

export async function listAdminCategories(
  client: PrismaClient,
): Promise<AdminCategoryRow[]> {
  const categories = await client.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      sortOrder: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });
  return categories.map(({ _count, ...category }) => ({
    ...category,
    productCount: _count.products,
  }));
}

export async function getAdminCategory(client: PrismaClient, id: string) {
  const category = await client.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!category) return null;
  const { _count, ...rest } = category;
  return { ...rest, productCount: _count.products };
}

export type AdminSetRow = {
  id: string;
  name: string;
  slug: string;
  releaseDate: IsoDate | null;
  productCount: number;
  updatedAt: Date;
};

export async function listAdminSets(
  client: PrismaClient,
): Promise<AdminSetRow[]> {
  const sets = await client.pokemonSet.findMany({
    orderBy: [
      { releaseDate: { sort: "desc", nulls: "last" } },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      slug: true,
      releaseDate: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });
  return sets.map(({ _count, releaseDate, ...set }) => ({
    ...set,
    releaseDate: releaseDate ? toIsoDate(releaseDate) : null,
    productCount: _count.products,
  }));
}

export async function getAdminSet(client: PrismaClient, id: string) {
  const set = await client.pokemonSet.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!set) return null;
  const { _count, releaseDate, ...rest } = set;
  return {
    ...rest,
    releaseDate: releaseDate ? toIsoDate(releaseDate) : null,
    productCount: _count.products,
  };
}
