import { formatSekInput } from "@/lib/money";
import type {
  CategoryFormValues,
  PokemonSetFormValues,
  ProductFormValues,
} from "@/lib/validation/catalog";

/*
 * Stored records → raw form values (strings and booleans), the inverse of
 * the form schemas. Used for the edit pages' initial values and to reset a
 * form to the saved state after a successful save.
 */

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: "",
  slug: "",
  shortDescription: "",
  description: "",
  productType: "SEALED",
  categoryId: "",
  pokemonSetId: "",
  price: "",
  compareAtPrice: "",
  sku: "",
  stockOnHand: "0",
  status: "DRAFT",
  isPreorder: false,
  isFeatured: false,
  releaseDate: "",
  seoTitle: "",
  seoDescription: "",
};

export function productFormValues(product: {
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  productType: ProductFormValues["productType"];
  categoryId: string;
  pokemonSetId: string | null;
  priceAmount: number;
  compareAtPriceAmount: number | null;
  sku: string;
  stockOnHand: number;
  status: ProductFormValues["status"];
  isPreorder: boolean;
  isFeatured: boolean;
  releaseDate: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}): ProductFormValues {
  return {
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    productType: product.productType,
    categoryId: product.categoryId,
    pokemonSetId: product.pokemonSetId ?? "",
    price: formatSekInput(product.priceAmount),
    compareAtPrice:
      product.compareAtPriceAmount === null
        ? ""
        : formatSekInput(product.compareAtPriceAmount),
    sku: product.sku,
    stockOnHand: String(product.stockOnHand),
    status: product.status,
    isPreorder: product.isPreorder,
    isFeatured: product.isFeatured,
    releaseDate: product.releaseDate ?? "",
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
  };
}

export const EMPTY_CATEGORY_FORM: CategoryFormValues = {
  name: "",
  slug: "",
  description: "",
  sortOrder: "0",
  seoTitle: "",
  seoDescription: "",
};

export function categoryFormValues(category: {
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
}): CategoryFormValues {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description ?? "",
    sortOrder: String(category.sortOrder),
    seoTitle: category.seoTitle ?? "",
    seoDescription: category.seoDescription ?? "",
  };
}

export const EMPTY_SET_FORM: PokemonSetFormValues = {
  name: "",
  slug: "",
  description: "",
  releaseDate: "",
  seoTitle: "",
  seoDescription: "",
};

export function pokemonSetFormValues(set: {
  name: string;
  slug: string;
  description: string | null;
  releaseDate: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}): PokemonSetFormValues {
  return {
    name: set.name,
    slug: set.slug,
    description: set.description ?? "",
    releaseDate: set.releaseDate ?? "",
    seoTitle: set.seoTitle ?? "",
    seoDescription: set.seoDescription ?? "",
  };
}
