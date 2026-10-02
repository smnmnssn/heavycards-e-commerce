import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { SectionHeading } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { Price } from "@/components/store/price";
import { ProductCard, ProductGrid } from "@/components/store/product-card";
import { ProductGallery } from "@/components/store/product-gallery";
import {
  ProductReviews,
  ReviewSummaryLink,
} from "@/components/store/product-reviews";
import {
  PurchaseAction,
  PurchasePanel,
} from "@/components/store/purchase-panel";
import { Container } from "@/components/ui/container";
import type { ProductType } from "@/generated/prisma/enums";
import { categoryPath, productPath, setPath } from "@/lib/catalog-paths";
import { formatIsoDate } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo/json-ld";
import {
  productMetaDescription,
  productSeoTitle,
} from "@/lib/seo/catalog-defaults";
import { pageMetadata } from "@/lib/seo/metadata";
import { presentationContext } from "@/server/catalog/listing";
import { notFoundUnlessMoved } from "@/server/catalog/not-found";
import {
  imageAlt,
  toParagraphs,
  toProductCardData,
} from "@/server/catalog/presenters";
import { productJsonLd } from "@/server/catalog/product-json-ld";
import { toCartProductView } from "@/server/cart/cart-products";
import { getProductPage } from "@/server/data/catalog";
import {
  listProducts,
  type ProductDetail,
} from "@/server/data/catalog-queries";
import { getAvailability } from "@/server/domain/catalog";

// Rendered on first visit, then served from cache and refreshed at most every
// 60 seconds. Checkout re-validates price and stock server-side (Milestone 8),
// and admin catalog edits revalidate it immediately
// (src/server/admin/catalog/revalidation.ts).
export const revalidate = 60;

export function generateStaticParams() {
  return [];
}

const productTypeLabels: Record<ProductType, string> = {
  SEALED: "Förseglad produkt",
  SINGLE: "Singelkort",
  GRADED: "Graderat kort",
  ACCESSORY: "Tillbehör",
  OTHER: "Övrigt",
};

const metaDescription = (product: ProductDetail) =>
  productMetaDescription({
    ...product,
    setName: product.pokemonSet?.name ?? null,
  });

export async function generateMetadata({
  params,
}: PageProps<"/pokemon-tcg/[productSlug]">): Promise<Metadata> {
  const { productSlug } = await params;
  const product = await getProductPage(productSlug);
  if (!product) return {};

  const firstImage = product.images[0];
  return pageMetadata({
    title: productSeoTitle(product),
    description: metaDescription(product),
    path: productPath(product.slug),
    // Discontinued products keep their page for existing links, unindexed.
    index: product.status !== "ARCHIVED",
    images: firstImage
      ? [
          {
            url: absoluteUrl(env.siteUrl, firstImage.url),
            width: firstImage.width,
            height: firstImage.height,
            alt: imageAlt(firstImage.altText, product.name),
          },
        ]
      : undefined,
  });
}

export default async function ProductPage({
  params,
}: PageProps<"/pokemon-tcg/[productSlug]">) {
  const { productSlug } = await params;
  const product = await getProductPage(productSlug);
  if (!product) return notFoundUnlessMoved(productPath(productSlug));

  const now = new Date();
  const context = await presentationContext(now);
  const state = getAvailability({
    status: product.status,
    isPreorder: product.isPreorder,
    availableQuantity: product.availableQuantity,
    lowStockThreshold: context.lowStockThreshold,
  });
  // Cart data for the add-to-cart control, built with the same rules the
  // cart API uses (the drawer refreshes it from the server when opened).
  const cartView = toCartProductView({
    productId: product.id,
    name: product.name,
    slug: product.slug,
    setName: product.pokemonSet?.name ?? null,
    status: product.status,
    isPreorder: product.isPreorder,
    releaseDate: product.releaseDate,
    priceAmount: product.priceAmount,
    availableQuantity: product.availableQuantity,
    image: product.images[0] ?? null,
  });
  const releasedAlready =
    product.releaseDate !== null && product.releaseDate <= context.today;
  const images = product.images.map((image, index) => ({
    id: image.id,
    src: image.url,
    alt: imageAlt(image.altText, product.name, index),
    width: image.width,
    height: image.height,
  }));

  const related =
    product.status === "ARCHIVED"
      ? []
      : (
          await listProducts(db, {
            setSlug: product.pokemonSet?.slug,
            categorySlug: product.pokemonSet
              ? undefined
              : product.category.slug,
            excludeProductId: product.id,
            sort: "newest",
            page: 1,
            pageSize: 4,
            now,
          })
        ).items.map((item) => toProductCardData(item, context));

  // Hem → Pokémon TCG → category → product: the hierarchy of the category
  // landing page, in the visible trail and in BreadcrumbList alike.
  const breadcrumbs = [
    { label: "Hem", href: "/" },
    { label: "Pokémon TCG", href: "/pokemon-tcg" },
    {
      label: product.category.name,
      href: categoryPath(product.category.slug),
    },
    { label: product.name },
  ];
  const description = metaDescription(product);
  const paragraphs = toParagraphs(product.description);

  return (
    <Container className="py-8 sm:py-12">
      {product.status !== "ARCHIVED" && (
        <JsonLdScript
          data={[
            productJsonLd({
              siteUrl: env.siteUrl,
              product,
              state,
              description,
            }),
            breadcrumbJsonLd(env.siteUrl, breadcrumbs),
          ]}
        />
      )}
      <Breadcrumbs items={breadcrumbs} />

      <div className="mt-6 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <ProductGallery images={images} />

        <div className="lg:sticky lg:top-28 lg:self-start">
          {product.pokemonSet && (
            <Link
              href={setPath(product.pokemonSet.slug)}
              className="inline-flex min-h-11 items-center type-eyebrow text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {product.pokemonSet.name}
            </Link>
          )}
          <h1 className="text-[clamp(1.625rem,1.25rem+1.4vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.005em] text-balance uppercase [font-stretch:112%]">
            {product.name}
          </h1>
          <ReviewSummaryLink summary={product.reviewSummary} />

          <div className="mt-5">
            <Price
              amount={product.priceAmount}
              compareAtAmount={product.compareAtPriceAmount}
              className="text-2xl [&_s]:text-base"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Inklusive moms. Frakt beräknas i kassan.
            </p>
          </div>

          {product.shortDescription && (
            <p className="mt-6 text-muted-foreground">
              {product.shortDescription}
            </p>
          )}

          <div className="mt-6">
            <PurchasePanel
              state={state}
              releaseDate={product.releaseDate}
              releasedAlready={releasedAlready}
              action={<PurchaseAction state={state} product={cartView} />}
            />
          </div>

          <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
            <dt className="text-muted-foreground">Kategori</dt>
            <dd>
              <Link
                href={categoryPath(product.category.slug)}
                className="underline underline-offset-4"
              >
                {product.category.name}
              </Link>
            </dd>
            {product.pokemonSet && (
              <>
                <dt className="text-muted-foreground">Set</dt>
                <dd>
                  <Link
                    href={setPath(product.pokemonSet.slug)}
                    className="underline underline-offset-4"
                  >
                    {product.pokemonSet.name}
                  </Link>
                </dd>
              </>
            )}
            {product.releaseDate && (
              <>
                <dt className="text-muted-foreground">Släppdatum</dt>
                <dd>{formatIsoDate(product.releaseDate)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Produkttyp</dt>
            <dd>{productTypeLabels[product.productType]}</dd>
          </dl>
        </div>
      </div>

      {paragraphs.length > 0 && (
        <section
          aria-labelledby="beskrivning"
          className="mt-16 grid gap-6 border-t border-border pt-12 lg:mt-24 lg:grid-cols-[1fr_2fr] lg:gap-16"
        >
          <h2 id="beskrivning" className="type-h2">
            Produktbeskrivning
          </h2>
          <div className="prose-store">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      )}

      <div className="mt-16 border-t border-border pt-12 lg:mt-24">
        <ProductReviews
          reviews={product.reviews}
          summary={product.reviewSummary}
        />
      </div>

      {related.length > 0 && (
        <section className="mt-16 border-t border-border pt-12 lg:mt-24">
          <SectionHeading
            title={
              product.pokemonSet
                ? `Mer från ${product.pokemonSet.name}`
                : `Mer inom ${product.category.name}`
            }
            action={{
              label: "Visa alla",
              href: product.pokemonSet
                ? setPath(product.pokemonSet.slug)
                : categoryPath(product.category.slug),
            }}
          />
          <ProductGrid>
            {related.map((card) => (
              <ProductCard key={card.href} product={card} />
            ))}
          </ProductGrid>
        </section>
      )}
    </Container>
  );
}
