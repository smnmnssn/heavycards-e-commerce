import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LockIcon, PackageIcon, TruckIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";

/*
 * Homepage shell. Demonstrates the visual system without inventing catalog
 * content: product sections (new arrivals, categories, featured, upcoming)
 * are populated from the database in Milestone 4.
 */

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

export default function HomePage() {
  return (
    <>
      <Section tone="inverted" className="overflow-hidden">
        <Container>
          <div className="max-w-5xl py-6 sm:py-10 lg:py-16">
            <p className="type-eyebrow text-muted-foreground">
              Pokémon TCG · Sverige
            </p>
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
        </Container>
      </Section>

      <Section spacing="compact" className="border-b border-border">
        <Container>
          <h2 className="sr-only">Därför HeavyCards</h2>
          <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6 lg:gap-12">
            {promises.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <Icon className="mt-0.5 size-6 shrink-0" />
                <div>
                  <h3 className="type-h3 text-base">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
