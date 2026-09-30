import "server-only";

import type { PrismaClient, ProductStatus } from "@/generated/prisma/client";
import { MAX_LINE_QUANTITY, type ShipmentGroup } from "@/lib/cart/cart";
import type { CartProductView, UnavailableReason } from "@/lib/cart/evaluate";
import { toIsoDate, type IsoDate } from "@/lib/dates";
import { imageAlt } from "@/server/catalog/presenters";
import {
  getAvailability,
  hasPublicPage,
  isPurchasable,
  type AvailabilityState,
} from "@/server/domain/catalog";
import { availableToSell } from "@/server/domain/inventory";

/**
 * Current, server-authoritative data for the products in a browser cart:
 * price, availability, quantity limit and shipment group. One query for all
 * products (reservations and first image included).
 *
 * Products without a public page (unknown, draft, unpublished) return only
 * their ID and "not_found", so the endpoint reveals nothing about them.
 *
 * Milestone 8 reuses this inside the checkout transaction (with row locks)
 * as the authoritative source for prices and stock.
 */
export async function loadCartProducts(
  client: PrismaClient,
  productIds: readonly string[],
  now: Date,
): Promise<CartProductView[]> {
  const products = await client.product.findMany({
    where: { id: { in: [...productIds] } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      isPreorder: true,
      releaseDate: true,
      publishedAt: true,
      priceAmount: true,
      stockOnHand: true,
      pokemonSet: { select: { name: true } },
      images: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 1,
        select: { url: true, altText: true, width: true, height: true },
      },
      reservations: {
        where: { status: "ACTIVE", expiresAt: { gt: now } },
        select: { quantity: true, status: true, expiresAt: true },
      },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  return productIds.map((productId): CartProductView => {
    const product = byId.get(productId);
    if (!product || !hasPublicPage(product, now)) {
      return {
        productId,
        available: false,
        unavailableReason: "not_found",
        name: null,
        slug: null,
        setName: null,
        image: null,
        unitPriceAmount: null,
        maxQuantity: 0,
        shipment: null,
      };
    }

    return toCartProductView({
      productId,
      name: product.name,
      slug: product.slug,
      setName: product.pokemonSet?.name ?? null,
      status: product.status,
      isPreorder: product.isPreorder,
      releaseDate: product.releaseDate ? toIsoDate(product.releaseDate) : null,
      priceAmount: product.priceAmount,
      availableQuantity: availableToSell(
        product.stockOnHand,
        product.reservations,
        now,
      ),
      image: product.images[0] ?? null,
    });
  });
}

export type CartViewInput = {
  productId: string;
  name: string;
  slug: string;
  setName: string | null;
  status: ProductStatus;
  isPreorder: boolean;
  releaseDate: IsoDate | null;
  priceAmount: number;
  /** stockOnHand − active reservations. */
  availableQuantity: number;
  image: {
    url: string;
    altText: string | null;
    width: number;
    height: number;
  } | null;
};

/**
 * Builds the cart's view of a product with a public page. Shared by the
 * product page (initial add-to-cart data) and `loadCartProducts`, so both
 * apply identical rules.
 */
export function toCartProductView(input: CartViewInput): CartProductView {
  // The threshold only affects labels, which the cart does not show.
  const state = getAvailability({
    status: input.status,
    isPreorder: input.isPreorder,
    availableQuantity: input.availableQuantity,
    lowStockThreshold: 0,
  });
  const available = isPurchasable(state);
  const shipment: ShipmentGroup = input.isPreorder
    ? { kind: "preorder", releaseDate: input.releaseDate }
    : { kind: "stock" };

  return {
    productId: input.productId,
    available,
    unavailableReason: unavailableReason(state),
    name: input.name,
    slug: input.slug,
    setName: input.setName,
    image: input.image
      ? {
          url: input.image.url,
          alt: imageAlt(input.image.altText, input.name),
          width: input.image.width,
          height: input.image.height,
        }
      : null,
    unitPriceAmount: input.priceAmount,
    maxQuantity: available
      ? Math.min(input.availableQuantity, MAX_LINE_QUANTITY)
      : 0,
    shipment,
  };
}

function unavailableReason(state: AvailabilityState): UnavailableReason | null {
  switch (state) {
    case "in_stock":
    case "low_stock":
    case "preorder":
      return null;
    default:
      return state;
  }
}
