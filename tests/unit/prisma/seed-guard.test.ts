import { describe, expect, it, vi } from "vitest";

import {
  SeedGuardError,
  assertNoRealAdministrators,
  assertSeedAllowed,
} from "../../../prisma/seed/guard";

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

  it("allows a remote database only when the opt-in names its host (staging)", () => {
    expect(
      assertSeedAllowed({
        DATABASE_URL: remote,
        SEED_ALLOW_REMOTE_DATABASE: "db.provider.example",
      }),
    ).toEqual({ hostname: "db.provider.example", local: false });
  });

  it.each(["true", "1", "other-staging.provider.example"])(
    "refuses a remote database whose host the opt-in %j does not name",
    (optIn) => {
      expect(() =>
        assertSeedAllowed({
          DATABASE_URL: remote,
          SEED_ALLOW_REMOTE_DATABASE: optIn,
        }),
      ).toThrow(/set SEED_ALLOW_REMOTE_DATABASE to exactly this host name/);
    },
  );

  it("reports local targets", () => {
    expect(assertSeedAllowed({ DATABASE_URL: local })).toEqual({
      hostname: "localhost",
      local: true,
    });
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

describe("assertNoRealAdministrators", () => {
  const dbWith = (count: number) => ({
    adminUser: { count: vi.fn(async () => count) },
  });

  it("passes when every administrator uses a .test address", async () => {
    const db = dbWith(0);
    await expect(assertNoRealAdministrators(db)).resolves.toBeUndefined();
    expect(db.adminUser.count).toHaveBeenCalledWith({
      where: { NOT: { email: { endsWith: ".test" } } },
    });
  });

  it("refuses a database with a real administrator", async () => {
    await expect(assertNoRealAdministrators(dbWith(1))).rejects.toThrow(
      /real administrators/,
    );
  });
});
