/**
 * The full landing-page text of a category or set, below its products.
 * Plain text from admin, rendered as escaped paragraphs.
 */
export function LandingText({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: readonly string[];
}) {
  if (paragraphs.length === 0) return null;

  return (
    <section
      aria-labelledby="om-sidan"
      className="mt-16 grid gap-6 border-t border-border pt-12 lg:mt-24 lg:grid-cols-[1fr_2fr] lg:gap-16"
    >
      <h2 id="om-sidan" className="type-h2">
        {title}
      </h2>
      <div className="prose-store">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}
