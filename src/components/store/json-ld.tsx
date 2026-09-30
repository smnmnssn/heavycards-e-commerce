import { serializeJsonLd, type JsonLd } from "@/lib/seo/json-ld";

/** Structured data script. Content is escaped by `serializeJsonLd`. */
export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
