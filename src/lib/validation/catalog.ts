import { z } from "zod";

import { ProductStatus, ProductType } from "@/generated/prisma/enums";
import { parseSekInput } from "@/lib/money";
import { SLUG_PATTERN } from "@/lib/slug";

/*
 * Admin catalog forms. The same schemas run in the browser (React Hook Form,
 * for immediate feedback) and in every server action, where they are the
 * authoritative validation. Inputs are the raw form values (strings and
 * booleans); outputs are typed domain values ready for Prisma.
 *
 * Length limits mirror the database columns (prisma/schema.prisma).
 */

export const PRODUCT_NAME_MAX = 200;
export const PRODUCT_SLUG_MAX = 200;
export const TAXONOMY_NAME_MAX = 120;
export const TAXONOMY_SLUG_MAX = 120;
export const SHORT_DESCRIPTION_MAX = 500;
export const DESCRIPTION_MAX = 20_000;
export const SKU_MAX = 64;
export const SEO_TITLE_MAX = 200;
export const SEO_DESCRIPTION_MAX = 500;
/** Search engines show roughly this much; longer values are allowed. */
export const SEO_TITLE_RECOMMENDED = 60;
export const SEO_DESCRIPTION_RECOMMENDED = 160;
/** Sanity bound for a manually entered stock level. */
export const STOCK_MAX = 1_000_000;
export const SORT_ORDER_MIN = -9_999;
export const SORT_ORDER_MAX = 9_999;

export const requiredText = (
  max: number,
  emptyMessage: string,
  label: string,
) =>
  z
    .string({ error: emptyMessage })
    .trim()
    .min(1, emptyMessage)
    .max(max, `${label} får vara högst ${max} tecken.`);

/** Blank → null, so "no value" is stored as NULL rather than "". */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label} får vara högst ${max} tecken.`))
    .transform((value) => (value === "" ? null : value));

const slugSchema = (max: number) =>
  z
    .string({ error: "Ange en URL-slug." })
    .trim()
    .toLowerCase()
    .min(1, "Ange en URL-slug.")
    .max(max, `Sluggen får vara högst ${max} tecken.`)
    .regex(
      SLUG_PATTERN,
      "Använd bara a–z, 0–9 och enkla bindestreck (t.ex. destined-rivals-booster-box).",
    );

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** "" → null, otherwise a real calendar date as "YYYY-MM-DD". */
const optionalIsoDate = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value), {
    error: "Ange ett giltigt datum (ÅÅÅÅ-MM-DD).",
  })
  .transform((value) => (value === "" ? null : value));

export const moneySchema = (message: string) =>
  z.string({ error: message }).transform((value, ctx) => {
    const amount = parseSekInput(value);
    if (amount === null) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return amount;
  });

export const optionalMoneySchema = (message: string) =>
  z.string().transform((value, ctx) => {
    if (value.trim() === "") return null;
    const amount = parseSekInput(value);
    if (amount === null) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return amount;
  });

export const integerSchema = (min: number, max: number, message: string) =>
  z.string({ error: message }).transform((value, ctx) => {
    const trimmed = value.trim();
    if (!/^-?\d{1,9}$/.test(trimmed)) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    const number = Number(trimmed);
    if (number < min || number > max) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return number;
  });

/** Stock is a whole number of units, never negative (PROJECT.md §78). */
export const stockOnHandSchema = integerSchema(
  0,
  STOCK_MAX,
  `Ange lagersaldot som ett heltal mellan 0 och ${STOCK_MAX.toLocaleString("sv-SE")}.`,
);

/** SKUs are stored uppercase so uniqueness is effectively case-insensitive. */
export const skuSchema = z
  .string({ error: "Ange ett artikelnummer (SKU)." })
  .trim()
  .toUpperCase()
  .min(1, "Ange ett artikelnummer (SKU).")
  .max(SKU_MAX, `Artikelnumret får vara högst ${SKU_MAX} tecken.`)
  .regex(
    /^[A-Z0-9]+([._-][A-Z0-9]+)*$/,
    "Använd bara A–Z, 0–9 och enkla skiljetecken (- _ .), t.ex. SV10-BB-EN.",
  );

const seoFields = {
  seoTitle: optionalText(SEO_TITLE_MAX, "SEO-titeln"),
  seoDescription: optionalText(SEO_DESCRIPTION_MAX, "Metabeskrivningen"),
};

// --- Products -------------------------------------------------------------------

export const productFormSchema = z
  .object({
    name: requiredText(PRODUCT_NAME_MAX, "Ange ett produktnamn.", "Namnet"),
    slug: slugSchema(PRODUCT_SLUG_MAX),
    shortDescription: optionalText(SHORT_DESCRIPTION_MAX, "Kortbeskrivningen"),
    description: optionalText(DESCRIPTION_MAX, "Beskrivningen"),
    productType: z.enum(ProductType, { error: "Välj en produkttyp." }),
    categoryId: z.uuid({ error: "Välj en kategori." }),
    pokemonSetId: z
      .union([z.literal(""), z.uuid()], { error: "Välj ett giltigt set." })
      .transform((value) => (value === "" ? null : value)),
    price: moneySchema("Ange priset i kronor, t.ex. 1499 eller 1499,50."),
    compareAtPrice: optionalMoneySchema(
      "Ange jämförpriset i kronor, t.ex. 1799, eller lämna fältet tomt.",
    ),
    sku: skuSchema,
    stockOnHand: stockOnHandSchema,
    status: z.enum(ProductStatus, { error: "Välj en status." }),
    isPreorder: z.boolean(),
    isFeatured: z.boolean(),
    releaseDate: optionalIsoDate,
    ...seoFields,
  })
  .superRefine((product, ctx) => {
    if (product.price <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "Priset måste vara större än 0 kr.",
      });
    }
    // Mirrors the products_compare_at_price_check constraint.
    if (
      product.compareAtPrice !== null &&
      product.compareAtPrice <= product.price
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["compareAtPrice"],
        message: "Jämförpriset måste vara högre än priset.",
      });
    }
  });

export type ProductFormValues = z.input<typeof productFormSchema>;
export type ProductInput = z.output<typeof productFormSchema>;

// --- Categories -----------------------------------------------------------------

export const categoryFormSchema = z.object({
  name: requiredText(TAXONOMY_NAME_MAX, "Ange ett namn.", "Namnet"),
  slug: slugSchema(TAXONOMY_SLUG_MAX),
  description: optionalText(DESCRIPTION_MAX, "Beskrivningen"),
  sortOrder: integerSchema(
    SORT_ORDER_MIN,
    SORT_ORDER_MAX,
    `Ange sorteringsordningen som ett heltal mellan ${SORT_ORDER_MIN} och ${SORT_ORDER_MAX}.`,
  ),
  ...seoFields,
});

export type CategoryFormValues = z.input<typeof categoryFormSchema>;
export type CategoryInput = z.output<typeof categoryFormSchema>;

// --- Pokémon sets ---------------------------------------------------------------

export const pokemonSetFormSchema = z.object({
  name: requiredText(TAXONOMY_NAME_MAX, "Ange ett namn.", "Namnet"),
  slug: slugSchema(TAXONOMY_SLUG_MAX),
  description: optionalText(DESCRIPTION_MAX, "Beskrivningen"),
  releaseDate: optionalIsoDate,
  ...seoFields,
});

export type PokemonSetFormValues = z.input<typeof pokemonSetFormSchema>;
export type PokemonSetInput = z.output<typeof pokemonSetFormSchema>;

// --- Product images -------------------------------------------------------------

export const IMAGE_ALT_MAX = 300;

/** Blank alt text → null: the storefront then generates it from the name. */
export const imageAltSchema = optionalText(IMAGE_ALT_MAX, "Alt-texten");

// --- Helpers --------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

/** First message per top-level field, for showing errors next to inputs. */
export function fieldErrorsFrom(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
