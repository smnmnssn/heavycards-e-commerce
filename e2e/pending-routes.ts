/**
 * Routes that the navigation already links to but that are implemented in a
 * later milestone (docs/routes.md). Next.js prefetches visible links, so
 * until then the browser logs a 404 for each of these.
 *
 * Tests tolerate 404s for exactly these paths and nothing else. Remove each
 * entry when its page is built (Milestone 4); the list should end up empty.
 */
export const PENDING_ROUTES: readonly string[] = [
  "/nyheter",
  "/pokemon-tcg",
  "/kommande",
  "/sok",
];

export function isPendingRoute(url: string): boolean {
  return PENDING_ROUTES.includes(new URL(url).pathname);
}
