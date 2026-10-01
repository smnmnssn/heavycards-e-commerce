import type { ProductStatus } from "@/generated/prisma/enums";
import type { IsoDate } from "@/lib/dates";

/*
 * Operational rules shown to administrators. Pure functions, so the list,
 * the edit page and the tests share one definition.
 */

export type StockLevel = "ok" | "low" | "out";

/**
 * Low stock uses StoreSettings.lowStockThreshold on available-to-sell
 * (stock on hand minus active reservations), the same quantity the
 * storefront uses for its "Få kvar" label.
 */
export function stockLevel(
  availableQuantity: number,
  lowStockThreshold: number,
): StockLevel {
  if (availableQuantity <= 0) return "out";
  return availableQuantity <= lowStockThreshold ? "low" : "ok";
}

/**
 * A preorder whose release date has passed. `isPreorder` stays authoritative
 * (docs/architecture.md → Milestone 5), so this is only a reminder for the
 * administrator; nothing is changed automatically.
 */
export function isPreorderPastRelease(
  product: { isPreorder: boolean; releaseDate: IsoDate | null },
  today: IsoDate,
): boolean {
  return (
    product.isPreorder &&
    product.releaseDate !== null &&
    product.releaseDate <= today
  );
}

export type ProductWarningInput = {
  status: ProductStatus;
  isPreorder: boolean;
  releaseDate: IsoDate | null;
  imageCount: number;
  availableQuantity: number;
};

/** Swedish notices for the product edit page, most important first. */
export function productWarnings(
  product: ProductWarningInput,
  today: IsoDate,
): string[] {
  const warnings: string[] = [];
  if (isPreorderPastRelease(product, today)) {
    warnings.push(
      "Produkten är fortfarande markerad som förbeställning trots att släppdatumet har passerat. Avmarkera förbeställning när varorna finns i lager.",
    );
  }
  if (product.status === "COMING_SOON" && product.isPreorder === false) {
    if (product.releaseDate !== null && product.releaseDate <= today) {
      warnings.push(
        "Status är ”Kommer snart” men släppdatumet har passerat. Byt till ”Aktiv” när produkten kan säljas.",
      );
    }
  }
  const visible =
    product.status === "ACTIVE" || product.status === "COMING_SOON";
  if (visible && product.imageCount === 0) {
    warnings.push("Produkten är publicerad men saknar bild.");
  }
  if (visible && product.isPreorder && product.availableQuantity <= 0) {
    warnings.push(
      "Förbeställningen har inget tillgängligt antal kvar. Lagersaldot är förbeställningskvoten; öka det för att ta emot fler förbeställningar.",
    );
  }
  return warnings;
}
