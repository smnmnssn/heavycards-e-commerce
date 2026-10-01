import type { ProductStatus, ProductType } from "@/generated/prisma/enums";
import type { BadgeVariant } from "@/components/ui/badge";

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "Utkast",
  ACTIVE: "Aktiv",
  COMING_SOON: "Kommer snart",
  ARCHIVED: "Arkiverad",
};

/** What each status means for customers, shown next to the status choice. */
export const PRODUCT_STATUS_HINTS: Record<ProductStatus, string> = {
  DRAFT: "Syns inte i butiken.",
  ACTIVE: "Publicerad och köpbar när det finns lager.",
  COMING_SOON:
    "Publicerad men inte köpbar, om den inte är markerad som förbeställning.",
  ARCHIVED:
    "Säljs inte längre. Visas inte i listor; en publicerad produktsida finns kvar (noindex) så gamla länkar och ordrar fungerar.",
};

export const PRODUCT_STATUS_BADGES: Record<ProductStatus, BadgeVariant> = {
  DRAFT: "outline",
  ACTIVE: "solid",
  COMING_SOON: "outline",
  ARCHIVED: "muted",
};

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  SEALED: "Förseglad produkt",
  SINGLE: "Singelkort",
  GRADED: "Graderat kort",
  ACCESSORY: "Tillbehör",
  OTHER: "Övrigt",
};

export const PRODUCT_STATUSES = Object.keys(
  PRODUCT_STATUS_LABELS,
) as ProductStatus[];
export const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_LABELS) as ProductType[];
