import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createCspNonce,
} from "@/lib/security/content-security-policy";

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name!, values];
    }),
  );

describe("contentSecurityPolicy", () => {
  it("storefront: own origin only, inline scripts for static pages", () => {
    const policy = directives(contentSecurityPolicy({ development: false }));

    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("admin: a nonce with strict-dynamic and no inline allowance", () => {
    const policy = directives(
      contentSecurityPolicy({ development: false, nonce: "abc123==" }),
    );
    expect(policy.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'strict-dynamic'",
    ]);
  });

  it("allows eval only for the development server", () => {
    expect(contentSecurityPolicy({ development: false })).not.toContain(
      "unsafe-eval",
    );
    expect(contentSecurityPolicy({ development: true })).toContain(
      "'unsafe-eval'",
    );
  });

  it("names no third-party origin (no analytics, no embeds, self-hosted fonts)", () => {
    for (const nonce of [undefined, "n"]) {
      expect(contentSecurityPolicy({ development: false, nonce })).not.toMatch(
        /https?:|\*/,
      );
    }
  });

  it("creates 128-bit base64 nonces", () => {
    const nonce = createCspNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createCspNonce()).not.toBe(nonce);
  });
});
