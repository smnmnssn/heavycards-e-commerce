import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "@/lib/env/schema";

const DATABASE_URL = "postgresql://user:secret-password@localhost:5432/app";

/** Minimal valid environment; individual tests override what they exercise. */
const parse = (overrides: Record<string, string | undefined> = {}) =>
  parseServerEnv({ DATABASE_URL, ...overrides });

describe("parseServerEnv", () => {
  it("falls back to localhost in development when APP_URL is unset", () => {
    expect(parse({ NODE_ENV: "development" })).toEqual({
      nodeEnv: "development",
      vercelEnv: undefined,
      siteUrl: "http://localhost:3000",
      databaseUrl: DATABASE_URL,
    });
  });

  it("defaults NODE_ENV to development", () => {
    expect(parse().nodeEnv).toBe("development");
  });

  it("uses APP_URL and normalizes it to an origin without trailing slash", () => {
    const env = parse({
      NODE_ENV: "production",
      APP_URL: "https://heavycards.se/",
    });

    expect(env.siteUrl).toBe("https://heavycards.se");
  });

  it("prefers APP_URL over the Vercel deployment URL", () => {
    const env = parse({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "heavycards-abc123.vercel.app",
      APP_URL: "https://staging.heavycards.se",
    });

    expect(env.siteUrl).toBe("https://staging.heavycards.se");
  });

  it("uses the Vercel deployment URL for previews without APP_URL", () => {
    const env = parse({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "heavycards-abc123.vercel.app",
    });

    expect(env.siteUrl).toBe("https://heavycards-abc123.vercel.app");
  });

  it("treats empty values as unset", () => {
    const env = parse({
      NODE_ENV: "development",
      APP_URL: "",
      VERCEL_ENV: "",
    });

    expect(env.siteUrl).toBe("http://localhost:3000");
    expect(env.vercelEnv).toBeUndefined();
  });

  it("requires APP_URL for production builds outside Vercel previews", () => {
    expect(() => parse({ NODE_ENV: "production" })).toThrow(EnvValidationError);
  });

  it("requires APP_URL in the Vercel production environment even when VERCEL_URL exists", () => {
    expect(() =>
      parse({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        VERCEL_URL: "heavycards.vercel.app",
      }),
    ).toThrow(/APP_URL: required in the Vercel production environment/);
  });

  it("requires https in the Vercel production environment", () => {
    expect(() =>
      parse({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        APP_URL: "http://heavycards.se",
      }),
    ).toThrow(/must use https/);
  });

  it("rejects APP_URL values with a path", () => {
    expect(() => parse({ APP_URL: "https://heavycards.se/butik" })).toThrow(
      /origin without path/,
    );
  });

  it.each(["not a url", "ftp://heavycards.se", "javascript:alert(1)"])(
    "rejects invalid APP_URL %j",
    (value) => {
      expect(() => parse({ APP_URL: value })).toThrow(EnvValidationError);
    },
  );

  it("rejects unknown NODE_ENV and VERCEL_ENV values", () => {
    expect(() => parse({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
    expect(() => parse({ VERCEL_ENV: "staging" })).toThrow(/VERCEL_ENV/);
  });

  it("accepts both postgres:// and postgresql:// database URLs", () => {
    const url = "postgres://user:pw@db.example.com:5432/heavycards";

    expect(parse({ DATABASE_URL: url }).databaseUrl).toBe(url);
  });

  it.each([undefined, "", "mysql://user:pw@localhost/app", "not a url"])(
    "rejects missing or non-PostgreSQL DATABASE_URL %j",
    (value) => {
      expect(() => parse({ DATABASE_URL: value })).toThrow(
        /DATABASE_URL: must be a postgresql:\/\/ connection URL/,
      );
    },
  );

  it("never includes offending values or credentials in the error message", () => {
    const secretLookingValue = "sk_live_should_never_be_logged";

    try {
      parse({
        APP_URL: secretLookingValue,
        DATABASE_URL: "mysql://user:db-password-123@localhost/app",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const { message } = error as EnvValidationError;
      expect(message).toContain("APP_URL");
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(secretLookingValue);
      expect(message).not.toContain("db-password-123");
    }
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parse())).toBe(true);
  });
});
