import { z } from "zod";

import { formatSekInput } from "@/lib/money";

import {
  integerSchema,
  moneySchema,
  optionalMoneySchema,
  optionalText,
  requiredText,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from "./catalog";

/*
 * The merchant-editable store settings (/admin/settings). The same schema
 * runs in the browser (React Hook Form) and in the server action, where it
 * is authoritative. Inputs are the raw form strings; amounts are typed in
 * kronor and become integer öre (string arithmetic, never floats).
 *
 * Only business values live here. Infrastructure configuration (Stripe and
 * Resend keys, AUTH_SECRET, database URLs, CRON_SECRET, sender address…)
 * stays in environment variables and is never shown or edited in admin.
 */

export const STORE_NAME_MAX = 120;
export const CONTACT_EMAIL_MAX = 320;
export const COMPANY_NAME_MAX = 200;
/** Sanity bounds that catch a misplaced digit (e.g. 7900 kr for 79 kr). */
export const SHIPPING_PRICE_MAX = 100_000; // 1 000 kr
export const FREE_SHIPPING_THRESHOLD_MAX = 10_000_000; // 100 000 kr
export const LOW_STOCK_THRESHOLD_MAX = 1_000;

/** Swedish VAT rates (basis points). 25 % applies to trading cards. */
export const VAT_RATE_OPTIONS = {
  "2500": "25 %",
  "1200": "12 %",
  "600": "6 %",
  "0": "0 %",
} as const;
export type VatRateOption = keyof typeof VAT_RATE_OPTIONS;

export const SHIPPING_CARRIER_OPTIONS = {
  POSTNORD: "PostNord",
  OTHER: "Annat fraktbolag",
} as const;

/**
 * Swedish organisationsnummer (or the personnummer of a sole trader):
 * 10 digits, optionally with the century and a hyphen, valid Luhn check
 * digit. Stored as "NNNNNN-NNNN".
 */
export function normalizeOrganizationNumber(value: string): string | null {
  const compact = value.replace(/[\s-]/g, "");
  if (!/^(\d{2})?\d{10}$/.test(compact)) return null;
  const digits = compact.slice(-10);
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(digits[index]) * (index % 2 === 0 ? 2 : 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : null;
}

const organizationNumberSchema = z.string().transform((value, ctx) => {
  if (value.trim() === "") return null;
  const normalized = normalizeOrganizationNumber(value);
  if (!normalized) {
    ctx.addIssue({
      code: "custom",
      message: "Ange ett giltigt organisationsnummer, t.ex. 556677-8899.",
    });
    return z.NEVER;
  }
  return normalized;
});

export const storeSettingsFormSchema = z
  .object({
    storeName: requiredText(
      STORE_NAME_MAX,
      "Ange butikens namn.",
      "Butiksnamnet",
    ),
    contactEmail: z
      .string({ error: "Ange kundtjänstens e-postadress." })
      .trim()
      .min(1, "Ange kundtjänstens e-postadress.")
      .max(
        CONTACT_EMAIL_MAX,
        `E-postadressen får vara högst ${CONTACT_EMAIL_MAX} tecken.`,
      )
      .pipe(z.email("Ange en giltig e-postadress, t.ex. hej@heavycards.se.")),
    companyName: optionalText(COMPANY_NAME_MAX, "Företagsnamnet"),
    organizationNumber: organizationNumberSchema,
    shippingPrice: moneySchema(
      "Ange fraktpriset i kronor, t.ex. 79 eller 79,50 (0 för gratis frakt).",
    ),
    freeShippingThreshold: optionalMoneySchema(
      "Ange gränsen i kronor, t.ex. 1500, eller lämna fältet tomt.",
    ),
    defaultShippingCarrier: z.enum(["POSTNORD", "OTHER"], {
      error: "Välj fraktbolag.",
    }),
    vatRate: z
      .enum(Object.keys(VAT_RATE_OPTIONS) as [VatRateOption], {
        error: "Välj en momssats.",
      })
      .transform(Number),
    lowStockThreshold: integerSchema(
      0,
      LOW_STOCK_THRESHOLD_MAX,
      `Ange ett heltal mellan 0 och ${LOW_STOCK_THRESHOLD_MAX.toLocaleString("sv-SE")}.`,
    ),
    defaultSeoTitle: optionalText(SEO_TITLE_MAX, "SEO-titeln"),
    defaultSeoDescription: optionalText(
      SEO_DESCRIPTION_MAX,
      "Metabeskrivningen",
    ),
  })
  .superRefine((settings, ctx) => {
    if (settings.shippingPrice > SHIPPING_PRICE_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["shippingPrice"],
        message: `Fraktpriset får vara högst ${formatSekInput(SHIPPING_PRICE_MAX)} kr.`,
      });
    }
    const threshold = settings.freeShippingThreshold;
    if (threshold !== null && threshold <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["freeShippingThreshold"],
        message:
          "Gränsen måste vara större än 0 kr. Sätt fraktpriset till 0 för gratis frakt på allt.",
      });
    }
    if (threshold !== null && threshold > FREE_SHIPPING_THRESHOLD_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["freeShippingThreshold"],
        message: `Gränsen får vara högst ${formatSekInput(FREE_SHIPPING_THRESHOLD_MAX)} kr.`,
      });
    }
  });

export type StoreSettingsFormValues = z.input<typeof storeSettingsFormSchema>;
export type StoreSettingsInput = z.output<typeof storeSettingsFormSchema>;
export type StoreSettingsField = keyof StoreSettingsFormValues;

/** The StoreSettings columns the form edits, in database units. */
export type StoreSettingsData = {
  storeName: string;
  contactEmail: string;
  companyName: string | null;
  organizationNumber: string | null;
  shippingPriceAmount: number;
  freeShippingThresholdAmount: number | null;
  defaultShippingCarrier: "POSTNORD" | "OTHER";
  vatRateBasisPoints: number;
  lowStockThreshold: number;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
};

export function storeSettingsData(
  input: StoreSettingsInput,
): StoreSettingsData {
  return {
    storeName: input.storeName,
    contactEmail: input.contactEmail,
    companyName: input.companyName,
    organizationNumber: input.organizationNumber,
    shippingPriceAmount: input.shippingPrice,
    freeShippingThresholdAmount: input.freeShippingThreshold,
    defaultShippingCarrier: input.defaultShippingCarrier,
    vatRateBasisPoints: input.vatRate,
    lowStockThreshold: input.lowStockThreshold,
    defaultSeoTitle: input.defaultSeoTitle,
    defaultSeoDescription: input.defaultSeoDescription,
  };
}

/**
 * Form values for stored settings, or blank values (with the usual Swedish
 * defaults) for a store that has not been configured yet.
 */
export function storeSettingsFormValues(
  settings: StoreSettingsData | null,
): StoreSettingsFormValues {
  if (!settings) {
    return {
      storeName: "HeavyCards",
      contactEmail: "",
      companyName: "",
      organizationNumber: "",
      shippingPrice: "",
      freeShippingThreshold: "",
      defaultShippingCarrier: "POSTNORD",
      vatRate: "2500",
      lowStockThreshold: "3",
      defaultSeoTitle: "",
      defaultSeoDescription: "",
    };
  }
  return {
    storeName: settings.storeName,
    contactEmail: settings.contactEmail,
    companyName: settings.companyName ?? "",
    organizationNumber: settings.organizationNumber ?? "",
    shippingPrice: formatSekInput(settings.shippingPriceAmount),
    freeShippingThreshold:
      settings.freeShippingThresholdAmount === null
        ? ""
        : formatSekInput(settings.freeShippingThresholdAmount),
    defaultShippingCarrier: settings.defaultShippingCarrier,
    vatRate: String(settings.vatRateBasisPoints) as VatRateOption,
    lowStockThreshold: String(settings.lowStockThreshold),
    defaultSeoTitle: settings.defaultSeoTitle ?? "",
    defaultSeoDescription: settings.defaultSeoDescription ?? "",
  };
}
