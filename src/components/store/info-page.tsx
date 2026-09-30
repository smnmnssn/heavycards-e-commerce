import type { Metadata } from "next";

import { Container } from "@/components/ui/container";
import { infoPages, type InfoPageSlug } from "@/lib/config/info-pages";

import { Breadcrumbs } from "./breadcrumbs";
import { PageHeader } from "./headings";

/**
 * Placeholder pages stay out of search results until the owner has written
 * and reviewed the real content (PROJECT.md §71).
 */
export function infoPageMetadata(slug: InfoPageSlug): Metadata {
  const page = infoPages[slug];
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${slug}` },
    robots: { index: false, follow: true },
  };
}

/** Template for information and legal pages: breadcrumbs, title, prose. */
export function InfoPlaceholderPage({ slug }: { slug: InfoPageSlug }) {
  const page = infoPages[slug];

  return (
    <Container className="py-10 sm:py-14 lg:py-20">
      <Breadcrumbs
        items={[{ label: "Hem", href: "/" }, { label: page.title }]}
      />
      <PageHeader
        eyebrow={page.section}
        title={page.title}
        lead={page.description}
        className="mt-8 sm:mt-12"
      />
      <div className="prose-store mt-10 border-t border-border pt-10">
        <p>
          Den här sidan är under uppbyggnad. Innehållet publiceras innan butiken
          öppnar.
        </p>
      </div>
    </Container>
  );
}
