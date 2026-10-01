import type { Metadata } from "next";

import { BrandMark } from "@/components/store/brand-mark";
import { SectionHeading } from "@/components/store/headings";
import {
  ProductCard,
  ProductGrid,
  type ProductCardData,
} from "@/components/store/product-card";
import { CategoryTiles } from "@/components/store/taxonomy-links";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LockIcon, PackageIcon, TruckIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { siteConfig } from "@/lib/config/site";
import { db } from "@/lib/db/client";
import { firstText, pageMetadata } from "@/lib/seo/metadata";
import { presentationContext } from "@/server/catalog/listing";
import { toProductCardData } from "@/server/catalog/presenters";
import {
  listCategories,
  listProducts,
  type ListingQuery,
} from "@/server/data/catalog-queries";
import { getPublicStoreInfo } from "@/server/data/store-settings";

// Served from cache and refreshed at most every 60 seconds, so the homepage
// follows catalog changes without a redeploy (PROJECT.md §10, §92).
export const revalidate = 60;

const DEFAULT_TITLE = `${siteConfig.brandName} – Pokémon TCG i Sverige`;
const DEFAULT_DESCRIPTION =
  "Förseglade Pokémon TCG-produkter: booster boxes, Elite Trainer Boxes, booster packs och mer. Priser inklusive moms och leverans inom Sverige.";

export async function generateMetadata(): Promise<Metadata> {
  const info = await getPublicStoreInfo();
  return pageMetadata({
    title: firstText(info.defaultSeoTitle) ?? DEFAULT_TITLE,
    description: firstText(info.defaultSeoDescription) ?? DEFAULT_DESCRIPTION,
    path: "/",
    absoluteTitle: true,
  });
}

const promises = [
  {
    icon: PackageIcon,
    title: "Förseglat och originalförpackat",
    text: "Vi säljer förseglade produkter i originalförpackning.",
  },
  {
    icon: TruckIcon,
    title: "Skickas med PostNord",
    text: "Vi levererar till adresser i Sverige.",
  },
  {
    icon: LockIcon,
    title: "Säker betalning",
    text: "Betalningen hanteras av Stripe. Vi ser aldrig dina kortuppgifter.",
  },
] as const;

export default async function HomePage() {
  const now = new Date();
  const section = (query: Partial<ListingQuery>) =>
    listProducts(db, { sort: "newest", page: 1, pageSize: 4, now, ...query });

  // One round of parallel queries; each section is bounded.
  const [featured, newArrivals, upcoming, categories, context] =
    await Promise.all([
      section({ scope: "featured" }),
      section({ scope: "new", pageSize: 8 }),
      section({ scope: "upcoming", sort: "release" }),
      listCategories(db, now),
      presentationContext(now),
    ]);
  const cards = (items: typeof featured.items) =>
    items.map((item) => toProductCardData(item, context));

  return (
    <>
      {/* Trust banner, directly under the header. It precedes the page's h1,
          so it is a labelled region with plain-text titles (no headings).
          Below lg it is a slim wrapping strip (icon + title; the supporting
          sentence stays available to screen readers). From lg up it is the
          original three-column layout. */}
      <Section
        spacing="compact"
        className="border-b border-border py-3 sm:py-3 lg:py-12"
        aria-label="Därför HeavyCards"
        data-section="trygghet"
      >
        <Container>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 lg:grid lg:grid-cols-3 lg:gap-12">
            {promises.map(({ icon: Icon, title, text }) => (
              <li
                key={title}
                className="flex items-center gap-1.5 lg:items-stretch lg:gap-4"
              >
                <Icon className="size-4 shrink-0 lg:mt-0.5 lg:size-6" />
                <div>
                  <p className="text-[0.8125rem] font-semibold lg:type-h3 lg:text-base">
                    {title}
                  </p>
                  <p className="sr-only lg:not-sr-only lg:mt-1 lg:text-sm lg:text-muted-foreground">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* Hero padding is ~10% tighter than the default section rhythm. */}
      <Section
        tone="inverted"
        className="overflow-hidden py-12 sm:py-19 lg:py-33"
        data-section="hero"
      >
        <Container>
          <div className="grid items-center gap-x-16 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-5xl">
              <div className="flex items-center justify-between gap-6">
                <p className="type-eyebrow text-foreground">
                  {siteConfig.brandName}
                </p>
                {/* Small mark beside the brand label below lg; the large one
                    sits in its own column on desktop. Both are decorative. */}
                <BrandMark className="h-10 sm:h-12 lg:hidden" />
              </div>
              <h1 className="mt-6 type-display">
                Förseglade Pokémon TCG-produkter
              </h1>
              <p className="mt-6 max-w-xl type-lead text-muted-foreground sm:mt-8">
                Booster boxes, Elite Trainer Boxes, booster packs och mer, noga
                utvalt för samlare och spelare.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/pokemon-tcg" size="lg">
                  Utforska sortimentet
                </ButtonLink>
                <ButtonLink href="/kommande" size="lg" variant="secondary">
                  Kommande släpp
                </ButtonLink>
              </div>
            </div>
            <BrandMark className="hidden lg:block lg:h-56 xl:h-64" />
          </div>
        </Container>
      </Section>

      <ProductSection
        id="utvalda"
        eyebrow="Utvalt av HeavyCards"
        title="Utvalda produkter"
        action={{ label: "Hela sortimentet", href: "/pokemon-tcg" }}
        products={cards(featured.items)}
        priority
      />

      {categories.some((category) => category.productCount > 0) && (
        <Section className="border-t border-border" aria-label="Kategorier">
          <Container>
            <SectionHeading
              title="Kategorier"
              action={{ label: "Pokémon TCG", href: "/pokemon-tcg" }}
            />
            <CategoryTiles categories={categories} />
          </Container>
        </Section>
      )}

      <ProductSection
        id="nyheter"
        eyebrow="Nytt i butiken"
        title="Nyheter"
        action={{ label: "Alla nyheter", href: "/nyheter" }}
        products={cards(newArrivals.items)}
      />

      <ProductSection
        id="kommande"
        eyebrow="Släppkalender"
        title="Kommande släpp"
        action={{ label: "Alla kommande", href: "/kommande" }}
        products={cards(upcoming.items)}
      />
    </>
  );
}

/** A homepage product row; renders nothing when the section has no products. */
function ProductSection({
  id,
  eyebrow,
  title,
  action,
  products,
  priority = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  action: { label: string; href: string };
  products: ProductCardData[];
  priority?: boolean;
}) {
  if (products.length === 0) return null;

  return (
    <Section
      className="border-t border-border"
      aria-label={title}
      data-section={id}
    >
      <Container>
        <SectionHeading eyebrow={eyebrow} title={title} action={action} />
        <ProductGrid>
          {products.map((product, index) => (
            <ProductCard
              key={product.href}
              product={product}
              priority={priority && index < 4}
            />
          ))}
        </ProductGrid>
      </Container>
    </Section>
  );
}
