import type {
  PaymentStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  ProductType,
} from "@/generated/prisma/client";
import { multiplyAmount, sumAmounts, vatPortionOfGross } from "@/lib/money";
import { calculateShippingAmount } from "@/server/domain/shipping";

/**
 * Development seed data. Idempotent: every record is upserted by a natural
 * key (slug, SKU, email, Stripe session id, order item), so running it twice
 * converges on the same data instead of duplicating it.
 *
 * All people, emails, phone numbers and Stripe ids are fictional. Commercial
 * settings (shipping price, thresholds) are placeholders, not business
 * decisions; production values are entered by the store owner.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC, the representation Prisma uses for `@db.Date` columns. */
const calendarDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

export type SeedSummary = {
  categories: number;
  pokemonSets: number;
  products: number;
  orders: number;
  reviews: number;
  adminUsers: number;
};

export async function seedDatabase(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<SeedSummary> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const futureDate = (days: number) =>
    calendarDate(
      new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10),
    );

  return db.$transaction(
    async (tx) => {
      // --- Store settings (singleton) --------------------------------------
      const settingsData = {
        storeName: "HeavyCards",
        contactEmail: "kundservice@example.com",
        shippingPriceAmount: 7_900,
        freeShippingThresholdAmount: 150_000,
        defaultShippingCarrier: "POSTNORD",
        vatRateBasisPoints: 2_500,
        lowStockThreshold: 3,
        defaultSeoTitle: "HeavyCards – Pokémon TCG i Sverige",
        defaultSeoDescription:
          "Förseglade Pokémon TCG-produkter: booster boxes, Elite Trainer Boxes, booster packs och mer.",
      } satisfies Prisma.StoreSettingsUncheckedCreateInput;
      const settings = await tx.storeSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...settingsData },
        update: settingsData,
      });

      // --- Administrators ---------------------------------------------------
      // No passwords: credentials are set through the secure flow built in
      // Milestone 6. Development defaults must never become real credentials.
      const owner = await tx.adminUser.upsert({
        where: { email: "owner@heavycards.test" },
        create: {
          name: "Utvecklingsägare",
          email: "owner@heavycards.test",
          role: "OWNER",
          isActive: true,
        },
        update: { role: "OWNER", isActive: true },
      });
      await tx.adminUser.upsert({
        where: { email: "admin@heavycards.test" },
        create: {
          name: "Utvecklingsadmin",
          email: "admin@heavycards.test",
          role: "ADMIN",
          isActive: true,
        },
        update: { role: "ADMIN", isActive: true },
      });

      // --- Categories ------------------------------------------------------
      const categoryRows = [
        [
          "booster-boxes",
          "Booster Boxes",
          "Hela displayer med booster packs från ett set, för dig som vill öppna mycket eller samla på förseglade boxar.",
        ],
        [
          "elite-trainer-boxes",
          "Elite Trainer Boxes",
          "Elite Trainer Boxes med booster packs, sleeves, tärningar och tillbehör för spel och samling.",
        ],
        [
          "booster-packs",
          "Booster Packs",
          "Enskilda booster packs och bundles från aktuella och tidigare set.",
        ],
        [
          "collection-boxes",
          "Collection Boxes",
          "Kollektioner med promokort, booster packs och extra innehåll.",
        ],
        ["tins", "Tins", "Tins och mini tins med booster packs."],
        [
          "tillbehor",
          "Tillbehör",
          "Tillbehör för att skydda och förvara dina kort.",
        ],
      ] as const;
      const categories: Record<string, string> = {};
      for (const [
        sortOrder,
        [slug, name, description],
      ] of categoryRows.entries()) {
        const category = await tx.category.upsert({
          where: { slug },
          create: { slug, name, description, sortOrder },
          update: { name, description, sortOrder },
        });
        categories[slug] = category.id;
      }

      // --- Pokémon sets ------------------------------------------------------
      const setRows: Array<[slug: string, name: string, releaseDate: Date]> = [
        [
          "scarlet-violet-151",
          "Scarlet & Violet—151",
          calendarDate("2023-09-22"),
        ],
        ["surging-sparks", "Surging Sparks", calendarDate("2024-11-08")],
        [
          "prismatic-evolutions",
          "Prismatic Evolutions",
          calendarDate("2025-01-17"),
        ],
        ["journey-together", "Journey Together", calendarDate("2025-03-28")],
        ["destined-rivals", "Destined Rivals", calendarDate("2025-05-30")],
        ["mega-evolution", "Mega Evolution", calendarDate("2025-09-26")],
        // Fictional upcoming set so "coming soon" data stays in the future.
        ["kommande-set", "Kommande set (utvecklingsdata)", futureDate(45)],
      ];
      const sets: Record<string, string> = {};
      for (const [slug, name, releaseDate] of setRows) {
        const description = `Förseglade produkter från ${name}.`;
        const set = await tx.pokemonSet.upsert({
          where: { slug },
          create: { slug, name, releaseDate, description },
          update: { name, releaseDate, description },
        });
        sets[slug] = set.id;
      }

      // --- Products ----------------------------------------------------------
      type SeedProduct = {
        sku: string;
        slug: string;
        name: string;
        shortDescription: string;
        description?: string;
        productType?: ProductType;
        category: string;
        set: string | null;
        priceAmount: number;
        compareAtPriceAmount?: number;
        stockOnHand: number;
        status: ProductStatus;
        isFeatured?: boolean;
        isPreorder?: boolean;
        releaseDate?: Date;
        publishedDaysAgo: number | null;
      };

      const productRows: SeedProduct[] = [
        {
          sku: "SV10-BB-EN",
          slug: "destined-rivals-booster-box",
          name: "Destined Rivals Booster Box",
          shortDescription:
            "Booster box med 36 booster packs från Destined Rivals.",
          description:
            "En förseglad booster box från Destined Rivals med 36 booster packs.\n\n" +
            "Boxen levereras i originalförpackning med oskadad plastfilm. Passar både för dig som vill öppna och för dig som samlar på förseglade produkter.",
          category: "booster-boxes",
          set: "destined-rivals",
          priceAmount: 219_900,
          stockOnHand: 12,
          status: "ACTIVE",
          isFeatured: true,
          publishedDaysAgo: 3,
        },
        {
          sku: "SV10-ETB-EN",
          slug: "destined-rivals-elite-trainer-box",
          name: "Destined Rivals Elite Trainer Box",
          shortDescription:
            "Elite Trainer Box med 9 booster packs, sleeves, tärningar och tillbehör.",
          category: "elite-trainer-boxes",
          set: "destined-rivals",
          priceAmount: 69_900,
          stockOnHand: 2,
          status: "ACTIVE",
          publishedDaysAgo: 3,
        },
        {
          sku: "SV10-BP-EN",
          slug: "destined-rivals-booster-pack",
          name: "Destined Rivals Booster Pack",
          shortDescription: "Ett booster pack med 10 kort.",
          category: "booster-packs",
          set: "destined-rivals",
          priceAmount: 6_900,
          stockOnHand: 150,
          status: "ACTIVE",
          publishedDaysAgo: 3,
        },
        {
          sku: "SV09-BB-EN",
          slug: "journey-together-booster-box",
          name: "Journey Together Booster Box",
          shortDescription:
            "Booster box med 36 booster packs från Journey Together.",
          category: "booster-boxes",
          set: "journey-together",
          priceAmount: 199_900,
          compareAtPriceAmount: 229_900,
          stockOnHand: 5,
          status: "ACTIVE",
          isFeatured: true,
          publishedDaysAgo: 20,
        },
        {
          sku: "SV8PT5-ETB-EN",
          slug: "prismatic-evolutions-elite-trainer-box",
          name: "Prismatic Evolutions Elite Trainer Box",
          shortDescription: "Elite Trainer Box från Prismatic Evolutions.",
          category: "elite-trainer-boxes",
          set: "prismatic-evolutions",
          priceAmount: 99_900,
          stockOnHand: 0,
          status: "ACTIVE",
          publishedDaysAgo: 40,
        },
        {
          sku: "SV8PT5-SPC-EN",
          slug: "prismatic-evolutions-super-premium-collection",
          name: "Prismatic Evolutions Super-Premium Collection",
          shortDescription:
            "Premiumkollektion med promokort och booster packs.",
          category: "collection-boxes",
          set: "prismatic-evolutions",
          priceAmount: 179_900,
          stockOnHand: 3,
          status: "ACTIVE",
          isFeatured: true,
          publishedDaysAgo: 40,
        },
        {
          sku: "SV08-MT-EN",
          slug: "surging-sparks-mini-tin",
          name: "Surging Sparks Mini Tin",
          shortDescription: "Mini tin med två booster packs.",
          category: "tins",
          set: "surging-sparks",
          priceAmount: 14_900,
          stockOnHand: 40,
          status: "ACTIVE",
          publishedDaysAgo: 60,
        },
        {
          sku: "ACC-TL35-25",
          slug: "toploaders-35pt-25-st",
          name: "Toploaders 35pt (25 st)",
          shortDescription: "Hårda plastfickor för att skydda enskilda kort.",
          productType: "ACCESSORY",
          category: "tillbehor",
          set: null,
          priceAmount: 4_900,
          stockOnHand: 60,
          status: "ACTIVE",
          publishedDaysAgo: 90,
        },
        {
          sku: "UPCOMING-BB-EN",
          slug: "kommande-set-booster-box",
          name: "Kommande set Booster Box",
          shortDescription:
            "Booster box från ett kommande set. Går inte att beställa ännu.",
          category: "booster-boxes",
          set: "kommande-set",
          priceAmount: 229_900,
          stockOnHand: 0,
          status: "COMING_SOON",
          releaseDate: futureDate(45),
          publishedDaysAgo: 1,
        },
        {
          sku: "UPCOMING-ETB-EN",
          slug: "kommande-set-elite-trainer-box",
          name: "Kommande set Elite Trainer Box",
          shortDescription:
            "Elite Trainer Box från ett kommande set. Kan förbeställas.",
          category: "elite-trainer-boxes",
          set: "kommande-set",
          priceAmount: 74_900,
          stockOnHand: 20,
          status: "COMING_SOON",
          isPreorder: true,
          releaseDate: futureDate(45),
          publishedDaysAgo: 1,
        },
        {
          sku: "ME01-BB-EN",
          slug: "mega-evolution-booster-box",
          name: "Mega Evolution Booster Box",
          shortDescription: "Booster box från Mega Evolution.",
          category: "booster-boxes",
          set: "mega-evolution",
          priceAmount: 219_900,
          stockOnHand: 0,
          status: "DRAFT",
          publishedDaysAgo: null,
        },
        {
          sku: "SV3PT5-BNDL-EN",
          slug: "scarlet-violet-151-booster-bundle",
          name: "Scarlet & Violet—151 Booster Bundle",
          shortDescription: "Booster bundle från Scarlet & Violet—151.",
          category: "booster-packs",
          set: "scarlet-violet-151",
          priceAmount: 49_900,
          stockOnHand: 0,
          status: "ARCHIVED",
          publishedDaysAgo: 300,
        },
      ];

      const products: Record<
        string,
        { id: string; name: string; sku: string; priceAmount: number }
      > = {};
      for (const row of productRows) {
        const data = {
          slug: row.slug,
          name: row.name,
          shortDescription: row.shortDescription,
          description: row.description ?? null,
          productType: row.productType ?? "SEALED",
          categoryId: categories[row.category]!,
          pokemonSetId: row.set ? sets[row.set]! : null,
          priceAmount: row.priceAmount,
          compareAtPriceAmount: row.compareAtPriceAmount ?? null,
          stockOnHand: row.stockOnHand,
          status: row.status,
          isFeatured: row.isFeatured ?? false,
          isPreorder: row.isPreorder ?? false,
          releaseDate: row.releaseDate ?? null,
          publishedAt:
            row.publishedDaysAgo === null
              ? null
              : daysAgo(row.publishedDaysAgo),
        } satisfies Omit<Prisma.ProductUncheckedCreateInput, "sku">;
        const product = await tx.product.upsert({
          where: { sku: row.sku },
          create: { sku: row.sku, ...data },
          update: data,
        });
        products[row.sku] = product;
      }

      // --- Orders --------------------------------------------------------------
      type SeedOrder = {
        checkoutSessionId: string;
        paymentIntentId?: string;
        lines: Array<[sku: string, quantity: number]>;
        paymentStatus: PaymentStatus;
        fulfillmentStatus?: "NEW" | "PROCESSING" | "SHIPPED" | "COMPLETED";
        createdDaysAgo: number;
        customer?: {
          email: string;
          firstName: string;
          lastName: string;
          phone: string;
          addressLine1: string;
          postalCode: string;
          city: string;
        };
        refundedAmount?: number;
        shippedDaysAgo?: number;
        trackingNumber?: string;
        reservation?: { status: "ACTIVE" | "RELEASED"; expiresAt: Date };
      };

      const orderRows: SeedOrder[] = [
        {
          checkoutSessionId: "cs_test_seed_shipped",
          paymentIntentId: "pi_test_seed_shipped",
          lines: [
            ["SV10-ETB-EN", 1],
            ["SV10-BP-EN", 3],
          ],
          paymentStatus: "PAID",
          fulfillmentStatus: "SHIPPED",
          createdDaysAgo: 10,
          customer: {
            email: "anna.andersson@example.com",
            firstName: "Anna",
            lastName: "Andersson",
            phone: "+46701740605",
            addressLine1: "Storgatan 1",
            postalCode: "111 22",
            city: "Stockholm",
          },
          shippedDaysAgo: 9,
          trackingNumber: "SEED0000000001SE",
        },
        {
          checkoutSessionId: "cs_test_seed_processing",
          paymentIntentId: "pi_test_seed_processing",
          lines: [["SV09-BB-EN", 1]],
          paymentStatus: "PAID",
          fulfillmentStatus: "PROCESSING",
          createdDaysAgo: 1,
          customer: {
            email: "erik.eriksson@example.com",
            firstName: "Erik",
            lastName: "Eriksson",
            phone: "+46701740606",
            addressLine1: "Kungsgatan 12",
            postalCode: "411 19",
            city: "Göteborg",
          },
        },
        {
          // Contains a product that has since been archived: history must stay intact.
          checkoutSessionId: "cs_test_seed_refunded",
          paymentIntentId: "pi_test_seed_refunded",
          lines: [
            ["SV3PT5-BNDL-EN", 2],
            ["ACC-TL35-25", 1],
          ],
          paymentStatus: "PARTIALLY_REFUNDED",
          fulfillmentStatus: "COMPLETED",
          createdDaysAgo: 120,
          customer: {
            email: "maria.nilsson@example.com",
            firstName: "Maria",
            lastName: "Nilsson",
            phone: "+46701740607",
            addressLine1: "Drottninggatan 5",
            postalCode: "211 11",
            city: "Malmö",
          },
          refundedAmount: 4_900,
          shippedDaysAgo: 118,
          trackingNumber: "SEED0000000002SE",
        },
        {
          // Checkout in progress: holds one unit until the reservation expires.
          checkoutSessionId: "cs_test_seed_pending",
          lines: [["SV10-BB-EN", 1]],
          paymentStatus: "PENDING",
          createdDaysAgo: 0,
          reservation: {
            status: "ACTIVE",
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          },
        },
        {
          // Abandoned checkout: reservation released, nothing paid.
          checkoutSessionId: "cs_test_seed_expired",
          lines: [["SV8PT5-SPC-EN", 1]],
          paymentStatus: "EXPIRED",
          createdDaysAgo: 2,
          reservation: { status: "RELEASED", expiresAt: daysAgo(2) },
        },
      ];

      const orderItemIds: Record<string, string> = {};
      for (const row of orderRows) {
        const items = row.lines.map(([sku, quantity]) => {
          const product = products[sku]!;
          return {
            productId: product.id,
            productNameSnapshot: product.name,
            skuSnapshot: product.sku,
            quantity,
            unitPriceAmount: product.priceAmount,
            totalPriceAmount: multiplyAmount(product.priceAmount, quantity),
            vatRateBasisPoints: settings.vatRateBasisPoints,
          };
        });
        const subtotalAmount = sumAmounts(items.map((i) => i.totalPriceAmount));
        const shippingAmount = calculateShippingAmount(
          subtotalAmount,
          settings,
        );
        const totalAmount = subtotalAmount + shippingAmount;
        const createdAt = daysAgo(row.createdDaysAgo);
        const isPaid =
          row.paymentStatus !== "PENDING" && row.paymentStatus !== "EXPIRED";
        const shippedAt =
          row.shippedDaysAgo === undefined ? null : daysAgo(row.shippedDaysAgo);

        const order = await tx.order.upsert({
          where: { stripeCheckoutSessionId: row.checkoutSessionId },
          update: {},
          create: {
            ...row.customer,
            subtotalAmount,
            shippingAmount,
            totalAmount,
            taxAmount: vatPortionOfGross(
              totalAmount,
              settings.vatRateBasisPoints,
            ),
            refundedAmount: row.refundedAmount ?? 0,
            paymentStatus: row.paymentStatus,
            fulfillmentStatus: row.fulfillmentStatus ?? "NEW",
            paidAt: isPaid ? createdAt : null,
            stripeCheckoutSessionId: row.checkoutSessionId,
            stripePaymentIntentId: row.paymentIntentId ?? null,
            shippingCarrier: shippedAt ? "POSTNORD" : null,
            trackingNumber: row.trackingNumber ?? null,
            shippedAt,
            confirmationEmailSentAt: isPaid ? createdAt : null,
            shippingEmailSentAt: shippedAt,
            createdAt,
            items: { create: items.map((item) => ({ ...item, createdAt })) },
            reservations: row.reservation
              ? {
                  create: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    status: row.reservation!.status,
                    expiresAt: row.reservation!.expiresAt,
                    createdAt,
                  })),
                }
              : undefined,
          },
          include: { items: true },
        });
        for (const item of order.items) {
          orderItemIds[`${row.checkoutSessionId}:${item.skuSnapshot}`] =
            item.id;
        }
      }

      // --- Reviews (verified purchases, one per order item) -------------------
      const reviewRows: Array<{
        orderItemKey: string;
        displayName: string;
        rating: number;
        title?: string;
        body: string;
        status: "PENDING" | "APPROVED" | "REJECTED";
      }> = [
        {
          orderItemKey: "cs_test_seed_shipped:SV10-ETB-EN",
          displayName: "Anna A.",
          rating: 5,
          title: "Perfekt skick",
          body: "Kom snabbt och välpackat. Förpackningen var helt oskadd.",
          status: "APPROVED",
        },
        {
          orderItemKey: "cs_test_seed_shipped:SV10-BP-EN",
          displayName: "Anna A.",
          rating: 4,
          body: "Roliga packs, bra pris per pack.",
          status: "PENDING",
        },
        {
          orderItemKey: "cs_test_seed_refunded:SV3PT5-BNDL-EN",
          displayName: "Maria",
          rating: 5,
          title: "Toppen",
          body: "Samlarvänlig förpackning, precis som beskrivet.",
          status: "APPROVED",
        },
        {
          orderItemKey: "cs_test_seed_refunded:ACC-TL35-25",
          displayName: "Maria",
          rating: 1,
          body: "Exempel på en recension som har avvisats av en administratör.",
          status: "REJECTED",
        },
      ];
      const reviewIds: Record<string, string> = {};
      for (const row of reviewRows) {
        const orderItemId = orderItemIds[row.orderItemKey]!;
        const orderItem = await tx.orderItem.findUniqueOrThrow({
          where: { id: orderItemId },
        });
        const review = await tx.review.upsert({
          where: { orderItemId },
          update: {},
          create: {
            orderItemId,
            productId: orderItem.productId,
            displayName: row.displayName,
            rating: row.rating,
            title: row.title ?? null,
            body: row.body,
            verifiedPurchase: true,
            status: row.status,
          },
        });
        reviewIds[row.orderItemKey] = review.id;
      }

      // --- Redirect example (a renamed product slug) -------------------------
      await tx.redirect.upsert({
        where: { sourcePath: "/pokemon-tcg/destined-rivals-bb" },
        create: {
          sourcePath: "/pokemon-tcg/destined-rivals-bb",
          destinationPath: "/pokemon-tcg/destined-rivals-booster-box",
        },
        update: {},
      });

      // --- Audit log examples (only on first run; the log is append-only) ----
      if ((await tx.auditLog.count()) === 0) {
        await tx.auditLog.createMany({
          data: [
            {
              adminUserId: owner.id,
              action: "UPDATE_PRODUCT_STOCK",
              entityType: "Product",
              entityId: products["SV10-ETB-EN"]!.id,
              metadata: { from: 5, to: 2 },
              createdAt: daysAgo(2),
            },
            {
              adminUserId: owner.id,
              action: "APPROVE_REVIEW",
              entityType: "Review",
              entityId: reviewIds["cs_test_seed_shipped:SV10-ETB-EN"]!,
              metadata: {},
              createdAt: daysAgo(1),
            },
          ],
        });
      }

      return {
        categories: await tx.category.count(),
        pokemonSets: await tx.pokemonSet.count(),
        products: await tx.product.count(),
        orders: await tx.order.count(),
        reviews: await tx.review.count(),
        adminUsers: await tx.adminUser.count(),
      };
    },
    { timeout: 60_000 },
  );
}
