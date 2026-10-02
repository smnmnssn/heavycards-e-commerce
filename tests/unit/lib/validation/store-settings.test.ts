import { describe, expect, it } from "vitest";

import {
  normalizeOrganizationNumber,
  storeSettingsData,
  storeSettingsFormSchema,
  storeSettingsFormValues,
  type StoreSettingsData,
} from "@/lib/validation/store-settings";

const valid = {
  storeName: " HeavyCards ",
  contactEmail: " hej@heavycards.se ",
  companyName: "",
  organizationNumber: "",
  shippingPrice: "79",
  freeShippingThreshold: "1500",
  defaultShippingCarrier: "POSTNORD",
  vatRate: "2500",
  lowStockThreshold: "3",
  defaultSeoTitle: "",
  defaultSeoDescription: "",
};

const parse = (overrides: Record<string, unknown> = {}) =>
  storeSettingsFormSchema.safeParse({ ...valid, ...overrides });

const errorFor = (field: string, value: unknown) => {
  const result = parse({ [field]: value });
  if (result.success) return null;
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
};

describe("store settings form schema", () => {
  it("parses kronor into integer öre and blanks into null", () => {
    const result = parse();
    expect(result.success).toBe(true);
    expect(storeSettingsData(result.data!)).toEqual({
      storeName: "HeavyCards",
      contactEmail: "hej@heavycards.se",
      companyName: null,
      organizationNumber: null,
      shippingPriceAmount: 7_900,
      freeShippingThresholdAmount: 150_000,
      defaultShippingCarrier: "POSTNORD",
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
      defaultSeoTitle: null,
      defaultSeoDescription: null,
    });
  });

  it.each([
    ["79", 7_900],
    ["79,50", 7_950],
    ["79.5", 7_950],
    ["0", 0],
    ["1 000", 100_000],
    ["49 kr", 4_900],
  ])("shipping price %j → %i öre", (input, expected) => {
    const result = parse({ shippingPrice: input });
    expect(result.success && result.data.shippingPrice).toBe(expected);
  });

  it.each(["", "-5", "79,999", "abc", "1e3", "1000,01"])(
    "rejects shipping price %j",
    (input) => {
      expect(errorFor("shippingPrice", input)).toBeTruthy();
    },
  );

  it("treats an empty free-shipping threshold as off and refuses 0 or absurd values", () => {
    const off = parse({ freeShippingThreshold: "  " });
    expect(off.success && off.data.freeShippingThreshold).toBeNull();
    expect(errorFor("freeShippingThreshold", "0")).toMatch(/större än 0/);
    expect(errorFor("freeShippingThreshold", "100000,01")).toMatch(/högst/);
    expect(errorFor("freeShippingThreshold", "100000")).toBeNull();
  });

  it("only accepts form strings, never pre-converted numbers", () => {
    expect(errorFor("shippingPrice", 7_900)).toBeTruthy();
    expect(errorFor("lowStockThreshold", 3)).toBeTruthy();
  });

  it("requires a store name and a valid customer-service email", () => {
    expect(errorFor("storeName", " ")).toBe("Ange butikens namn.");
    expect(errorFor("contactEmail", "")).toBe(
      "Ange kundtjänstens e-postadress.",
    );
    expect(errorFor("contactEmail", "kundservice")).toMatch(/giltig/);
    expect(errorFor("contactEmail", `${"a".repeat(320)}@x.se`)).toMatch(
      /högst 320/,
    );
  });

  it("limits VAT to the Swedish rates and the carrier to known values", () => {
    for (const rate of ["2500", "1200", "600", "0"]) {
      expect(errorFor("vatRate", rate)).toBeNull();
    }
    expect(errorFor("vatRate", "2000")).toBe("Välj en momssats.");
    expect(errorFor("vatRate", "25")).toBe("Välj en momssats.");
    expect(errorFor("defaultShippingCarrier", "DHL")).toBe("Välj fraktbolag.");
  });

  it("accepts a low-stock threshold of 0 to 1000 whole units", () => {
    expect(errorFor("lowStockThreshold", "0")).toBeNull();
    expect(errorFor("lowStockThreshold", "1000")).toBeNull();
    for (const value of ["-1", "1001", "2.5", ""]) {
      expect(errorFor("lowStockThreshold", value)).toBeTruthy();
    }
  });

  it("bounds the SEO texts by their columns", () => {
    expect(errorFor("defaultSeoTitle", "x".repeat(200))).toBeNull();
    expect(errorFor("defaultSeoTitle", "x".repeat(201))).toBeTruthy();
    expect(errorFor("defaultSeoDescription", "x".repeat(501))).toBeTruthy();
  });
});

describe("organisationsnummer", () => {
  it.each([
    ["202100-5448", "202100-5448"],
    ["2021005448", "202100-5448"],
    ["16202100-5448", "202100-5448"],
    [" 202100 5448 ", "202100-5448"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeOrganizationNumber(input)).toBe(expected);
  });

  it.each(["202100-5449", "12345", "abcdef-ghij", "202100-54481"])(
    "rejects %j (format or check digit)",
    (input) => {
      expect(normalizeOrganizationNumber(input)).toBeNull();
    },
  );

  it("is optional in the form", () => {
    expect(errorFor("organizationNumber", "")).toBeNull();
    expect(errorFor("organizationNumber", "556677-8890")).toMatch(/giltigt/);
  });
});

describe("form values ↔ stored settings", () => {
  const stored: StoreSettingsData = {
    storeName: "HeavyCards",
    contactEmail: "hej@heavycards.se",
    companyName: "HeavyCards AB",
    organizationNumber: "202100-5448",
    shippingPriceAmount: 4_950,
    freeShippingThresholdAmount: null,
    defaultShippingCarrier: "OTHER",
    vatRateBasisPoints: 1_200,
    lowStockThreshold: 0,
    defaultSeoTitle: null,
    defaultSeoDescription: "Beskrivning",
  };

  it("shows öre as kronor and round-trips without loss", () => {
    const values = storeSettingsFormValues(stored);
    expect(values).toMatchObject({
      shippingPrice: "49,50",
      freeShippingThreshold: "",
      vatRate: "1200",
      lowStockThreshold: "0",
      defaultSeoTitle: "",
    });
    const reparsed = storeSettingsFormSchema.parse(values);
    expect(storeSettingsData(reparsed)).toEqual(stored);
  });

  it("starts an unconfigured store with Swedish defaults and blank prices", () => {
    const values = storeSettingsFormValues(null);
    expect(values).toMatchObject({
      shippingPrice: "",
      vatRate: "2500",
      defaultShippingCarrier: "POSTNORD",
    });
    // Blank prices must be filled in before anything is saved.
    expect(storeSettingsFormSchema.safeParse(values).success).toBe(false);
  });
});
