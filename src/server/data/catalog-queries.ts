import "server-only";

import {
  Prisma,
  type PrismaClient,
  type ProductStatus,
  type ProductType,
} from "@/generated/prisma/client";
import { stockholmToday, toIsoDate, type IsoDate } from "@/lib/dates";
import type { SortKey } from "@/server/domain/catalog-params";
import { hasPublicPage, newArrivalsSince } from "@/server/domain/catalog";
import { availableToSell } from "@/server/domain/inventory";

/*
 * Catalog read queries. Every function takes the Prisma client explicitly so
 * the same code runs in pages (shared client) and in DB tests (test client).
 *
 * Listings use one parameterized SQL query because availability
 * (stock − active reservations) must be filterable and sortable in the
 * database for correct paging. The rules mirror src/server/domain/catalog.ts.
 * All user input reaches SQL only as bound parameters; ORDER BY fragments are
 * chosen from a fixed whitelist.
 */

export type ListingScope = "all" | "new" | "upcoming" | "featured";

export type ListingQuery = {
  scope?: ListingScope;
  categorySlug?: string;
  setSlug?: string;
  inStockOnly?: boolean;
  searchTerms?: readonly string[];
  excludeProductId?: string;
  sort: SortKey;
  page: number;
  pageSize: number;
  now: Date;
};

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  isPreorder: boolean;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  releaseDate: IsoDate | null;
  publishedAt: Date;
  setName: string | null;
  availableQuantity: number;
  image: ProductImageData | null;
};

export type ProductImageData = {
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

export type ListingResult = {
  items: ProductSummary[];
  total: number;
};

// --- SQL building blocks ------------------------------------------------------

/** Listable products: ACTIVE/COMING_SOON and already published. */
const listableSql = (now: Date) => Prisma.sql`
  p.status IN ('ACTIVE', 'COMING_SOON')
  AND p.published_at IS NOT NULL
  AND p.published_at <= ${now}`;

/** Purchasable now: sellable status with units left after reservations. */
const purchasableSql = Prisma.sql`
  (p.status = 'ACTIVE' OR (p.status = 'COMING_SOON' AND p.is_preorder))
  AND p.stock_on_hand - res.reserved > 0`;

/** Text a search term may match; é-variants folded like foldForSearch(). */
const searchTextSql = Prisma.sql`
  lower(translate(
    concat_ws(' ', p.name, p.short_description, p.sku, c.name, s.name),
    'ÉÈÊËéèêë', 'EEEEeeee'))`;

const nameTextSql = Prisma.sql`lower(translate(p.name, 'ÉÈÊËéèêë', 'EEEEeeee'))`;

const likePattern = (term: string) =>
  `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const termsMatch = (text: Prisma.Sql, terms: readonly string[]) =>
  Prisma.join(
    terms.map(
      (term) => Prisma.sql`${text} LIKE ${likePattern(term)} ESCAPE '\\'`,
    ),
    " AND ",
  );

const orderBySql: Record<SortKey, Prisma.Sql> = {
  newest: Prisma.sql`p.published_at DESC, p.id DESC`,
  "price-asc": Prisma.sql`p.price_amount ASC, p.published_at DESC, p.id DESC`,
  "price-desc": Prisma.sql`p.price_amount DESC, p.published_at DESC, p.id DESC`,
  release: Prisma.sql`p.release_date ASC NULLS LAST, p.published_at DESC, p.id DESC`,
  relevance: Prisma.sql`name_rank ASC, p.published_at DESC, p.id DESC`,
};

type ListingRow = {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  isPreorder: boolean;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  releaseDate: string | null;
  publishedAt: Date;
  setName: string | null;
  stockOnHand: number;
  reserved: number;
  imageUrl: string | null;
  imageAlt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  totalCount: number;
};

export async function listProducts(
  client: PrismaClient,
  query: ListingQuery,
): Promise<ListingResult> {
  const { now, scope = "all", searchTerms = [] } = query;
  const today = stockholmToday(now);

  const conditions: Prisma.Sql[] = [listableSql(now)];
  if (scope === "new") {
    conditions.push(
      Prisma.sql`p.status = 'ACTIVE' AND p.published_at >= ${newArrivalsSince(now)}`,
    );
  } else if (scope === "upcoming") {
    conditions.push(
      Prisma.sql`(p.status = 'COMING_SOON' OR p.is_preorder OR p.release_date > ${today}::date)`,
    );
  } else if (scope === "featured") {
    conditions.push(Prisma.sql`p.is_featured`);
  }
  if (query.categorySlug) {
    conditions.push(Prisma.sql`c.slug = ${query.categorySlug}`);
  }
  if (query.setSlug) {
    conditions.push(Prisma.sql`s.slug = ${query.setSlug}`);
  }
  if (query.inStockOnly) {
    conditions.push(purchasableSql);
  }
  if (query.excludeProductId) {
    conditions.push(Prisma.sql`p.id <> ${query.excludeProductId}::uuid`);
  }
  if (searchTerms.length > 0) {
    conditions.push(termsMatch(searchTextSql, searchTerms));
  }

  const nameRank =
    searchTerms.length > 0
      ? Prisma.sql`CASE WHEN ${termsMatch(nameTextSql, searchTerms)} THEN 0 ELSE 1 END`
      : Prisma.sql`0`;
  const sort: SortKey =
    query.sort === "relevance" && searchTerms.length === 0
      ? "newest"
      : query.sort;
  const offset = (query.page - 1) * query.pageSize;

  const rows = await client.$queryRaw<ListingRow[]>`
    SELECT
      p.id::text AS "id",
      p.slug,
      p.name,
      p.status::text AS "status",
      p.is_preorder AS "isPreorder",
      p.price_amount AS "priceAmount",
      p.compare_at_price_amount AS "compareAtPriceAmount",
      to_char(p.release_date, 'YYYY-MM-DD') AS "releaseDate",
      p.published_at AS "publishedAt",
      s.name AS "setName",
      p.stock_on_hand AS "stockOnHand",
      res.reserved,
      img.url AS "imageUrl",
      img.alt_text AS "imageAlt",
      img.width AS "imageWidth",
      img.height AS "imageHeight",
      ${nameRank} AS name_rank,
      count(*) OVER ()::int AS "totalCount"
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN pokemon_sets s ON s.id = p.pokemon_set_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r.quantity), 0)::int AS reserved
      FROM inventory_reservations r
      WHERE r.product_id = p.id AND r.status = 'ACTIVE' AND r.expires_at > ${now}
    ) res ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.url, i.alt_text, i.width, i.height
      FROM product_images i
      WHERE i.product_id = p.id
      ORDER BY i.position ASC, i.created_at ASC
      LIMIT 1
    ) img ON TRUE
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${orderBySql[sort]}
    LIMIT ${query.pageSize} OFFSET ${offset}
  `;

  let total = rows[0]?.totalCount ?? 0;
  if (rows.length === 0 && offset > 0) {
    // Past the last page: the window count is unavailable, so count directly.
    const [counted] = await client.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN pokemon_sets s ON s.id = p.pokemon_set_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(r.quantity), 0)::int AS reserved
        FROM inventory_reservations r
        WHERE r.product_id = p.id AND r.status = 'ACTIVE' AND r.expires_at > ${now}
      ) res ON TRUE
      WHERE ${Prisma.join(conditions, " AND ")}
    `;
    total = counted.total;
  }

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      isPreorder: row.isPreorder,
      priceAmount: row.priceAmount,
      compareAtPriceAmount: row.compareAtPriceAmount,
      releaseDate: row.releaseDate,
      publishedAt: row.publishedAt,
      setName: row.setName,
      availableQuantity: Math.max(0, row.stockOnHand - row.reserved),
      image:
        row.imageUrl && row.imageWidth && row.imageHeight
          ? {
              url: row.imageUrl,
              altText: row.imageAlt,
              width: row.imageWidth,
              height: row.imageHeight,
            }
          : null,
    })),
  };
}

// --- Taxonomy -------------------------------------------------------------------

const listableWhere = (now: Date): Prisma.ProductWhereInput => ({
  status: { in: ["ACTIVE", "COMING_SOON"] },
  publishedAt: { lte: now },
});

export type TaxonomyLink = {
  slug: string;
  name: string;
  productCount: number;
};

/** Categories in display order with their number of listable products. */
export async function listCategories(
  client: PrismaClient,
  now: Date,
): Promise<TaxonomyLink[]> {
  const categories = await client.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
      _count: { select: { products: { where: listableWhere(now) } } },
    },
  });
  return categories.map(({ slug, name, _count }) => ({
    slug,
    name,
    productCount: _count.products,
  }));
}

export type SetLink = TaxonomyLink & { releaseDate: IsoDate | null };

/** Pokémon sets, newest release first, with their listable product counts. */
export async function listSets(
  client: PrismaClient,
  now: Date,
): Promise<SetLink[]> {
  const sets = await client.pokemonSet.findMany({
    orderBy: [
      { releaseDate: { sort: "desc", nulls: "last" } },
      { name: "asc" },
    ],
    select: {
      slug: true,
      name: true,
      releaseDate: true,
      _count: { select: { products: { where: listableWhere(now) } } },
    },
  });
  return sets.map(({ slug, name, releaseDate, _count }) => ({
    slug,
    name,
    releaseDate: releaseDate ? toIsoDate(releaseDate) : null,
    productCount: _count.products,
  }));
}

const landingSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  seoTitle: true,
  seoDescription: true,
  updatedAt: true,
} as const;

export async function getCategoryBySlug(client: PrismaClient, slug: string) {
  return client.category.findUnique({ where: { slug }, select: landingSelect });
}

export async function getSetBySlug(client: PrismaClient, slug: string) {
  const set = await client.pokemonSet.findUnique({
    where: { slug },
    select: { ...landingSelect, releaseDate: true },
  });
  return set
    ? {
        ...set,
        releaseDate: set.releaseDate ? toIsoDate(set.releaseDate) : null,
      }
    : null;
}

// --- Product page ---------------------------------------------------------------

export type ProductReview = {
  id: string;
  displayName: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  createdAt: Date;
};

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  productType: ProductType;
  status: ProductStatus;
  isPreorder: boolean;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  releaseDate: IsoDate | null;
  publishedAt: Date | null;
  updatedAt: Date;
  seoTitle: string | null;
  seoDescription: string | null;
  category: { slug: string; name: string };
  pokemonSet: { slug: string; name: string } | null;
  images: Array<ProductImageData & { id: string }>;
  availableQuantity: number;
  reviews: ProductReview[];
  reviewSummary: { count: number; averageRating: number | null };
};

/** Newest approved reviews shown on the product page. */
export const PRODUCT_PAGE_REVIEW_LIMIT = 20;

/**
 * Loads a product page by slug. Returns null for unknown slugs and for
 * products that must not have a public page (drafts, unpublished); the
 * caller decides how to present archived products. Only APPROVED reviews are
 * loaded or counted.
 */
export async function getProductBySlug(
  client: PrismaClient,
  slug: string,
  now: Date,
): Promise<ProductDetail | null> {
  const product = await client.product.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      description: true,
      productType: true,
      status: true,
      isPreorder: true,
      priceAmount: true,
      compareAtPriceAmount: true,
      stockOnHand: true,
      releaseDate: true,
      publishedAt: true,
      updatedAt: true,
      seoTitle: true,
      seoDescription: true,
      category: { select: { slug: true, name: true } },
      pokemonSet: { select: { slug: true, name: true } },
      images: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          url: true,
          altText: true,
          width: true,
          height: true,
        },
      },
    },
  });

  if (!product || !hasPublicPage(product, now)) {
    return null;
  }

  const approved = { productId: product.id, status: "APPROVED" } as const;
  const [reservations, reviews, reviewStats] = await Promise.all([
    client.inventoryReservation.findMany({
      where: {
        productId: product.id,
        status: "ACTIVE",
        expiresAt: { gt: now },
      },
      select: { quantity: true, status: true, expiresAt: true },
    }),
    client.review.findMany({
      where: approved,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PRODUCT_PAGE_REVIEW_LIMIT,
      select: {
        id: true,
        displayName: true,
        rating: true,
        title: true,
        body: true,
        verifiedPurchase: true,
        createdAt: true,
      },
    }),
    client.review.aggregate({
      where: approved,
      _count: { _all: true },
      _avg: { rating: true },
    }),
  ]);

  const { stockOnHand, releaseDate, ...rest } = product;
  return {
    ...rest,
    releaseDate: releaseDate ? toIsoDate(releaseDate) : null,
    availableQuantity: availableToSell(stockOnHand, reservations, now),
    reviews,
    reviewSummary: {
      count: reviewStats._count._all,
      averageRating: reviewStats._avg.rating,
    },
  };
}
