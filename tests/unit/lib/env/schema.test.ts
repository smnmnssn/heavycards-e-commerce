import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "@/lib/env/schema";

const DATABASE_URL = "postgresql://user:secret-password@localhost:5432/app";
// Test-only value; any 32+ character string is valid.
const AUTH_SECRET = "unit-test-auth-secret-0123456789abcdef";

/** Minimal valid environment; individual tests override what they exercise. */
const parse = (overrides: Record<string, string | undefined> = {}) =>
  parseServerEnv({ DATABASE_URL, AUTH_SECRET, ...overrides });

describe("parseServerEnv", () => {
  it("falls back to localhost in development when APP_URL is unset", () => {
    expect(parse({ NODE_ENV: "development" })).toEqual({
      nodeEnv: "development",
      vercelEnv: undefined,
      siteUrl: "http://localhost:3000",
      databaseUrl: DATABASE_URL,
      authSecret: AUTH_SECRET,
      email: {
        transport: "console",
        from: "HeavyCards <no-reply@heavycards.invalid>",
      },
      storage: { provider: "local", directory: ".storage" },
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
    expect(Object.isFrozen(parse().email)).toBe(true);
  });
});

describe("parseServerEnv: admin authentication", () => {
  it.each([undefined, "", "too-short-secret"])(
    "requires an AUTH_SECRET of at least 32 characters (%j)",
    (value) => {
      expect(() => parse({ AUTH_SECRET: value })).toThrow(/AUTH_SECRET/);
    },
  );

  it("never echoes AUTH_SECRET in errors", () => {
    expect(() => parse({ AUTH_SECRET: "short-secret-value" })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("short-secret-value"),
      }),
    );
  });
});

describe("parseServerEnv: email", () => {
  const resend = {
    EMAIL_TRANSPORT: "resend",
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "HeavyCards <admin@example.com>",
  };

  it("does not send real email by default outside Vercel production", () => {
    expect(
      parse({ NODE_ENV: "production", APP_URL: "https://x.se" }).email,
    ).toMatchObject({ transport: "console" });
  });

  it("defaults to Resend in Vercel production and requires its settings", () => {
    const production = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      APP_URL: "https://heavycards.se",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
    };
    expect(() => parse(production)).toThrow(/RESEND_API_KEY and EMAIL_FROM/);
    expect(
      parse({ ...production, ...resend, EMAIL_TRANSPORT: undefined }).email,
    ).toEqual({
      transport: "resend",
      from: resend.EMAIL_FROM,
      resendApiKey: resend.RESEND_API_KEY,
    });
  });

  it.each(["console", "file"])(
    "refuses the %s transport in Vercel production",
    (transport) => {
      expect(() =>
        parse({
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          APP_URL: "https://heavycards.se",
          EMAIL_TRANSPORT: transport,
          EMAIL_OUTBOX_DIR: "/tmp/outbox",
        }),
      ).toThrow(/EMAIL_TRANSPORT/);
    },
  );

  it("accepts the file transport locally with an outbox directory", () => {
    expect(() => parse({ EMAIL_TRANSPORT: "file" })).toThrow(
      /EMAIL_OUTBOX_DIR/,
    );
    expect(
      parse({ EMAIL_TRANSPORT: "file", EMAIL_OUTBOX_DIR: "/tmp/outbox" }).email,
    ).toMatchObject({ transport: "file", outboxDir: "/tmp/outbox" });
    expect(() =>
      parse({
        EMAIL_TRANSPORT: "file",
        EMAIL_OUTBOX_DIR: "/tmp/outbox",
        VERCEL_ENV: "preview",
      }),
    ).toThrow(/local test runs only/);
  });

  it("never echoes the Resend API key", () => {
    expect(() =>
      parse({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_secret_123" }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("re_secret_123"),
      }),
    );
  });
});

describe("parseServerEnv: image storage", () => {
  it("uses local files outside Vercel, in a configurable directory", () => {
    expect(parse().storage).toEqual({
      provider: "local",
      directory: ".storage",
    });
    expect(parse({ STORAGE_LOCAL_DIR: ".e2e-storage" }).storage).toEqual({
      provider: "local",
      directory: ".e2e-storage",
    });
  });

  it("defaults to Vercel Blob on Vercel and refuses local storage there", () => {
    const preview = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "heavycards-abc123.vercel.app",
    };
    // Previews without a token keep working; uploads then fail clearly.
    expect(parse(preview).storage).toEqual({
      provider: "vercel-blob",
      blobToken: null,
    });
    expect(() => parse({ ...preview, STORAGE_PROVIDER: "local" })).toThrow(
      /local development and tests only/,
    );
  });

  it("requires a Blob token in Vercel production and never echoes it", () => {
    const production = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      APP_URL: "https://heavycards.se",
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "HeavyCards <a@b.se>",
    };
    expect(() => parse(production)).toThrow(/BLOB_READ_WRITE_TOKEN: required/);
    expect(
      parse({ ...production, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret" })
        .storage,
    ).toEqual({ provider: "vercel-blob", blobToken: "vercel_blob_rw_secret" });
    expect(() =>
      parse({
        ...production,
        STORAGE_PROVIDER: "bogus",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret",
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("vercel_blob_rw_secret"),
      }),
    );
  });
});
