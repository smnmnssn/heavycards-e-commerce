import "server-only";

import { notFound, permanentRedirect } from "next/navigation";

import { db } from "@/lib/db/client";

import { findRedirectDestination } from "./redirects";

/**
 * Ends rendering of a product, category or set page whose slug has no live
 * page: a permanent (308) redirect if the URL moved (PROJECT.md §61),
 * otherwise a real 404. Redirects are only looked up on this miss path, so
 * live pages never pay for the query.
 */
export async function notFoundUnlessMoved(path: string): Promise<never> {
  const destination = await findRedirectDestination(db, path);
  if (destination) permanentRedirect(destination);
  notFound();
}
