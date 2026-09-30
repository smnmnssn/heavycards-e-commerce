import { describe, expect, it } from "vitest";

import { SeedGuardError, assertSeedAllowed } from "../../../prisma/seed/guard";

const local = "postgresql://heavycards:heavycards@localhost:54320/heavycards";
const remote =
  "postgresql://user:secret-pw@db.provider.example:5432/heavycards";

describe("assertSeedAllowed", () => {
  it.each([
    local,
    "postgresql://u:p@127.0.0.1:5432/db",
    "postgresql://u:p@[::1]:5432/db",
  ])("allows local database %s", (DATABASE_URL) => {
    expect(() => assertSeedAllowed({ DATABASE_URL })).not.toThrow();
  });

  it("refuses remote databases without explicit opt-in", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: remote })).toThrow(
      SeedGuardError,
    );
  });

  it("allows remote databases with explicit opt-in (staging)", () => {
    expect(() =>
      assertSeedAllowed({
        DATABASE_URL: remote,
        SEED_ALLOW_REMOTE_DATABASE: "true",
      }),
    ).not.toThrow();
  });

  it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }])(
    "refuses production even with opt-in: %j",
    (production) => {
      expect(() =>
        assertSeedAllowed({
          DATABASE_URL: local,
          SEED_ALLOW_REMOTE_DATABASE: "true",
          ...production,
        }),
      ).toThrow(/production/);
    },
  );

  it("refuses when DATABASE_URL is missing or invalid", () => {
    expect(() => assertSeedAllowed({})).toThrow(SeedGuardError);
    expect(() => assertSeedAllowed({ DATABASE_URL: "nope" })).toThrow(
      SeedGuardError,
    );
  });

  it("never includes credentials in the error", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: remote })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secret-pw"),
      }),
    );
  });
});
