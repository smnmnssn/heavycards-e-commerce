/*
 * Content-Security-Policy (Milestone 14). Pure, so next.config.ts, the proxy
 * and unit tests share one definition.
 *
 * Two variants:
 *
 * - Storefront (next.config.ts, every route except /admin): static and ISR
 *   pages are rendered before any request exists, so they cannot carry a
 *   per-request nonce, and Next.js inlines its own bootstrap scripts. Scripts
 *   are therefore limited to our origin plus inline ('unsafe-inline'). The
 *   policy still blocks scripts from any other origin, plugins, <base>
 *   hijacking, framing, posting forms elsewhere, and sending data to other
 *   hosts (connect-src, img-src). Forcing every page dynamic to get nonces
 *   would give up ISR for product and category pages (SEO, Core Web Vitals,
 *   PROJECT.md §59).
 * - Admin (src/proxy.ts): every admin page is rendered per request, so it
 *   gets a fresh nonce and 'strict-dynamic': an injected inline script
 *   cannot run in the area that can change prices, stock and orders.
 *
 * HeavyCards loads nothing from third parties: fonts are self-hosted, images
 * go through /_next/image on our origin, Stripe Checkout is a full-page
 * redirect (never embedded) and there is no analytics. Adding a third-party
 * script or embed means extending this policy deliberately.
 */

export type ContentSecurityPolicyOptions = {
  /** `next dev` needs eval for React's debugging features. */
  development: boolean;
  /** Per-request nonce (admin only); omit for statically rendered pages. */
  nonce?: string;
};

export function contentSecurityPolicy({
  development,
  nonce,
}: ContentSecurityPolicyOptions): string {
  const scriptSources = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  if (development) scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // React style attributes and Next.js inline styles need 'unsafe-inline';
    // style injection cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A fresh, unguessable nonce (128 bits, base64). */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
