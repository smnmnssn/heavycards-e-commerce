import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/*
 * Permanent redirects for changed public URLs (PROJECT.md §61). Rows are
 * written only by catalog services, inside the transaction that changes the
 * slug, and are consulted by the storefront only when a product, category or
 * set URL has no live page (so a live page always wins over a redirect).
 *
 * Invariants kept on every write:
 * - at most one redirect per source path (unique index);
 * - no chains: every redirect points directly at a live path;
 * - no loops: a path that is live again never redirects anywhere.
 */

/**
 * Records that the page at `fromPath` now lives at `toPath` (a slug change,
 * or a deleted category/set whose URL now leads to the catalog root).
 */
export async function recordPathChange(
  tx: Prisma.TransactionClient,
  fromPath: string,
  toPath: string,
): Promise<void> {
  if (fromPath === toPath) return;
  // `toPath` is live (again): an older redirect away from it would loop.
  await releasePath(tx, toPath);
  // Flatten chains: links to the old path go straight to the new one.
  await tx.redirect.updateMany({
    where: { destinationPath: fromPath },
    data: { destinationPath: toPath },
  });
  await tx.redirect.upsert({
    where: { sourcePath: fromPath },
    create: { sourcePath: fromPath, destinationPath: toPath, permanent: true },
    update: { destinationPath: toPath, permanent: true },
  });
}

/** A live page now owns `path`, so any redirect from it is obsolete. */
export async function releasePath(
  tx: Prisma.TransactionClient,
  path: string,
): Promise<void> {
  await tx.redirect.deleteMany({ where: { sourcePath: path } });
}

/** Same-site absolute path only: never `//host` or a scheme. */
const isLocalPath = (path: string) => /^\/(?![/\\])/.test(path);

/** The permanent redirect target for a public path, if one exists. */
export async function findRedirectDestination(
  client: Db,
  path: string,
): Promise<string | null> {
  const redirect = await client.redirect.findUnique({
    where: { sourcePath: path },
    select: { destinationPath: true },
  });
  return redirect && isLocalPath(redirect.destinationPath)
    ? redirect.destinationPath
    : null;
}
