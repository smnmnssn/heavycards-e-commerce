import "server-only";

import { cache } from "react";

import { db } from "@/lib/db/client";

import {
  getCategoryBySlug,
  getProductBySlug,
  getSetBySlug,
} from "./catalog-queries";

/*
 * Request-scoped (React `cache`) wrappers for lookups that both
 * `generateMetadata` and the page need, so each runs once per render.
 */

// `now` is taken inside: a Date argument would defeat the cache (identity keys).
export const getProductPage = cache((slug: string) =>
  getProductBySlug(db, slug, new Date()),
);

export const getCategory = cache((slug: string) =>
  getCategoryBySlug(db, slug, new Date()),
);

export const getSet = cache((slug: string) =>
  getSetBySlug(db, slug, new Date()),
);
