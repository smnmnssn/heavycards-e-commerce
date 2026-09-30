import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "@/lib/env/schema";

describe("parseServerEnv", () => {
  it("falls back to localhost in development when APP_URL is unset", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });

    expect(env).toEqual({
      nodeEnv: "development",
      vercelEnv: undefined,
      siteUrl: "http://localhost:3000",
    });
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseServerEnv({}).nodeEnv).toBe("development");
  });

  it("uses APP_URL and normalizes it to an origin without trailing slash", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      APP_URL: "https://heavycards.se/",
    });

    expect(env.siteUrl).toBe("https://heavycards.se");
  });

  it("prefers APP_URL over the Vercel deployment URL", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "heavycards-abc123.vercel.app",
      APP_URL: "https://staging.heavycards.se",
    });

    expect(env.siteUrl).toBe("https://staging.heavycards.se");
  });

  it("uses the Vercel deployment URL for previews without APP_URL", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "heavycards-abc123.vercel.app",
    });

    expect(env.siteUrl).toBe("https://heavycards-abc123.vercel.app");
  });

  it("treats empty values as unset", () => {
    const env = parseServerEnv({
      NODE_ENV: "development",
      APP_URL: "",
      VERCEL_ENV: "",
    });

    expect(env.siteUrl).toBe("http://localhost:3000");
    expect(env.vercelEnv).toBeUndefined();
  });

  it("requires APP_URL for production builds outside Vercel previews", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production" })).toThrow(
      EnvValidationError,
    );
  });

  it("requires APP_URL in the Vercel production environment even when VERCEL_URL exists", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        VERCEL_URL: "heavycards.vercel.app",
      }),
    ).toThrow(/APP_URL: required in the Vercel production environment/);
  });

  it("requires https in the Vercel production environment", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        APP_URL: "http://heavycards.se",
      }),
    ).toThrow(/must use https/);
  });

  it("rejects APP_URL values with a path", () => {
    expect(() =>
      parseServerEnv({ APP_URL: "https://heavycards.se/butik" }),
    ).toThrow(/origin without path/);
  });

  it.each(["not a url", "ftp://heavycards.se", "javascript:alert(1)"])(
    "rejects invalid APP_URL %j",
    (value) => {
      expect(() => parseServerEnv({ APP_URL: value })).toThrow(
        EnvValidationError,
      );
    },
  );

  it("rejects unknown NODE_ENV and VERCEL_ENV values", () => {
    expect(() => parseServerEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
    expect(() => parseServerEnv({ VERCEL_ENV: "staging" })).toThrow(
      /VERCEL_ENV/,
    );
  });

  it("never includes the offending value in the error message", () => {
    const secretLookingValue = "sk_live_should_never_be_logged";

    try {
      parseServerEnv({ APP_URL: secretLookingValue });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toContain("APP_URL");
      expect((error as EnvValidationError).message).not.toContain(
        secretLookingValue,
      );
    }
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseServerEnv({}))).toBe(true);
  });
});
