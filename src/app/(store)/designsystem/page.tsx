import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CartButton } from "@/components/store/cart-button";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { PageHeader, SectionHeading } from "@/components/store/headings";
import { Price } from "@/components/store/price";
import {
  ProductCard,
  ProductCardSkeleton,
  ProductGrid,
  type ProductCardData,
} from "@/components/store/product-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { FieldMessage, Input, Label, Textarea } from "@/components/ui/form";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";

/*
 * Development-only visual reference for the design primitives. It returns 404
 * in production builds, and the sample data below exists only here: it is not
 * catalog content.
 */

export const metadata: Metadata = {
  title: "Designsystem",
  robots: { index: false, follow: false },
};

const sampleProducts: ProductCardData[] = [
  {
    href: "#",
    name: "Exempelprodukt med ett längre namn som bryts över två rader",
    subtitle: "Exempelset",
    priceAmount: 219_900,
  },
  {
    href: "#",
    name: "Exempelprodukt på rea",
    subtitle: "Exempelset",
    priceAmount: 199_900,
    compareAtPriceAmount: 229_900,
    badges: [{ label: "Rea", variant: "outline" }],
  },
  {
    href: "#",
    name: "Slutsåld exempelprodukt",
    subtitle: "Exempelset",
    priceAmount: 99_900,
    badges: [{ label: "Slutsåld", variant: "muted" }],
    unavailable: true,
  },
  {
    href: "#",
    name: "Förbeställd exempelprodukt",
    subtitle: "Kommande set",
    priceAmount: 74_950,
    badges: [{ label: "Förbeställ" }],
  },
];

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <>
      <Container className="py-12">
        <Breadcrumbs
          items={[{ label: "Hem", href: "/" }, { label: "Designsystem" }]}
        />
        <PageHeader
          className="mt-8"
          eyebrow="Utveckling"
          title="Designsystem"
          lead="Referens för typografi, knappar, formulär och produktkort."
        />
      </Container>

      <Section spacing="compact" className="border-t border-border">
        <Container className="space-y-6">
          <p className="type-eyebrow text-muted-foreground">Typografi</p>
          <p className="type-display">Display</p>
          <p className="type-h1">Rubrik 1</p>
          <p className="type-h2">Rubrik 2</p>
          <p className="type-h3">Rubrik 3</p>
          <p className="max-w-xl type-lead text-muted-foreground">
            Ingress. Förseglade produkter med generöst luftrum och tydlig
            typografi.
          </p>
          <p className="max-w-prose">
            Brödtext i 16 px med radavstånd 1,625. Åäö och siffror 0123456789
            återges med samma typsnitt.
          </p>
        </Container>
      </Section>

      <Section spacing="compact" className="border-t border-border">
        <Container className="space-y-6">
          <p className="type-eyebrow text-muted-foreground">Knappar</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Lägg i kundvagn</Button>
            <Button variant="secondary">Sekundär</Button>
            <Button variant="ghost">Diskret</Button>
            <Button variant="link">Länk</Button>
            <Button disabled>Inaktiv</Button>
            <Button size="sm">Liten</Button>
            <ButtonLink href="#" size="lg">
              Till kassan <ArrowRightIcon />
            </ButtonLink>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Förbeställ</Badge>
            <Badge variant="outline">Nyhet</Badge>
            <Badge variant="muted">Slutsåld</Badge>
            <Price amount={199_900} compareAtAmount={229_900} />
            <CartButton count={0} />
            <CartButton count={3} />
            <CartButton count={120} />
          </div>
        </Container>
      </Section>

      <Section tone="inverted" spacing="compact">
        <Container className="flex flex-wrap items-center gap-3">
          <Button>Primär på svart</Button>
          <Button variant="secondary">Sekundär på svart</Button>
          <Badge>Förbeställ</Badge>
        </Container>
      </Section>

      <Section spacing="compact">
        <Container size="prose" className="space-y-6">
          <p className="type-eyebrow text-muted-foreground">Formulär</p>
          <div className="grid gap-2">
            <Label htmlFor="ds-name">Visningsnamn</Label>
            <Input id="ds-name" placeholder="Till exempel Anna A." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-email">E-post</Label>
            <Input
              id="ds-email"
              type="email"
              aria-invalid="true"
              aria-describedby="ds-email-error"
              defaultValue="fel-adress"
            />
            <FieldMessage id="ds-email-error" tone="error">
              Ange en giltig e-postadress.
            </FieldMessage>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-review">Recension</Label>
            <Textarea id="ds-review" aria-describedby="ds-review-hint" />
            <FieldMessage id="ds-review-hint">Minst 10 tecken.</FieldMessage>
          </div>
        </Container>
      </Section>

      <Section spacing="compact" className="border-t border-border">
        <Container>
          <SectionHeading
            eyebrow="Produktkort"
            title="Exempel"
            action={{ label: "Visa alla", href: "#" }}
          />
          <ProductGrid>
            {sampleProducts.map((product) => (
              <ProductCard key={product.name} product={product} />
            ))}
            <ProductCardSkeleton />
          </ProductGrid>
        </Container>
      </Section>
    </>
  );
}
