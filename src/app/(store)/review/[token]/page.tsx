import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";

import { PageHeader } from "@/components/store/headings";
import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { ReviewForm } from "@/components/store/review-form";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import {
  findOpenInvitation,
  type ReviewableLine,
} from "@/server/reviews/invitations";
import {
  clientIp,
  consumeRateLimit,
  rateLimitKey,
  REVIEW_PAGE_RATE_LIMIT,
} from "@/server/security/rate-limit";

// The URL carries a bearer token: never indexed, never sent onward as a
// Referer (next.config.ts sends the same as HTTP headers).
export const metadata: Metadata = {
  title: "Recensera ditt köp",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Secure review page from the shipping email (PROJECT.md §46). The token
 * in the URL selects one shipped order's invitation and shows only that
 * order's products. Every unusable link (malformed, unknown, expired,
 * revoked, fully used) gets the same answer, so the page reveals nothing
 * about whether an order exists. Reading `headers()` makes the page render
 * per request; it is never cached.
 */
export default async function ReviewPage({
  params,
}: PageProps<"/review/[token]">) {
  const { token } = await params;
  const now = new Date();
  const limit = await consumeRateLimit(
    db,
    REVIEW_PAGE_RATE_LIMIT,
    rateLimitKey(
      REVIEW_PAGE_RATE_LIMIT,
      clientIp(await headers()),
      env.authSecret,
    ),
    now,
  );

  return (
    <Container className="py-12 sm:py-16 lg:py-20">
      {!limit.allowed ? (
        <Notice
          title="För många försök"
          text="Vänta en stund och ladda sedan om sidan."
        />
      ) : (
        <ReviewContent token={token} now={now} />
      )}
    </Container>
  );
}

async function ReviewContent({ token, now }: { token: string; now: Date }) {
  const invitation = await findOpenInvitation(db, token, now);
  if (!invitation) {
    return (
      <Notice
        title="Länken kan inte användas"
        text="Länken är ogiltig, har gått ut eller har redan använts. Har du frågor om din beställning är du välkommen att kontakta oss."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Verifierat köp"
        title="Recensera ditt köp"
        lead="Berätta vad du tycker om produkterna i din beställning. Recensionerna granskas innan de publiceras."
      />
      <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
        Vi publicerar ditt betyg, din text och det namn du väljer, aldrig din
        e-postadress eller adress.
      </p>
      <ul className="mt-10 grid max-w-3xl gap-8">
        {invitation.lines.map((line) => (
          <li key={line.orderItemId}>
            <ReviewLine token={token} line={line} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ReviewLine({ token, line }: { token: string; line: ReviewableLine }) {
  const headingId = `produkt-${line.orderItemId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="border border-border p-5 sm:p-8"
      data-testid="review-line"
    >
      <div className="flex items-center gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden bg-surface">
          {line.image ? (
            <Image
              src={line.image.url}
              alt={line.image.altText || line.name}
              width={line.image.width}
              height={line.image.height}
              sizes="80px"
              className="size-full object-contain p-1.5"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>
        <div className="min-w-0">
          <h2
            id={headingId}
            className="font-semibold break-words text-foreground"
          >
            {line.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {line.quantity} st
          </p>
        </div>
      </div>
      <div className="mt-6">
        {line.reviewed ? (
          <p className="border border-border bg-surface p-5">
            Du har redan recenserat den här produkten. Tack!
          </p>
        ) : (
          <ReviewForm
            token={token}
            orderItemId={line.orderItemId}
            productName={line.name}
          />
        )}
      </div>
    </section>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader eyebrow="Recensioner" title={title} lead={text} />
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/" variant="secondary">
          Till startsidan
        </ButtonLink>
        <ButtonLink href="/kontakt" variant="secondary">
          Kontakta oss
        </ButtonLink>
      </div>
    </>
  );
}
