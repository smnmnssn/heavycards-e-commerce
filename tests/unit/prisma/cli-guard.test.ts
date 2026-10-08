import { describe, expect, it } from "vitest";

import {
  PrismaCliGuardError,
  assertPrismaCommandAllowed,
} from "../../../prisma/cli-guard";

const local = "postgresql://heavycards:heavycards@localhost:54320/heavycards";
const neon =
  "postgresql://owner:npg-secret@ep-quiet-1234.eu-central-1.aws.neon.tech/heavycards?sslmode=verify-full";

describe("assertPrismaCommandAllowed", () => {
  it.each([
    ["migrate", "dev", "--name", "change"],
    ["migrate", "reset", "--force"],
    ["db", "push"],
    ["--schema", "prisma/schema.prisma", "migrate", "dev"],
  ])("refuses %j against a remote database", (...args) => {
    expect(() => assertPrismaCommandAllowed(args, neon)).toThrow(
      PrismaCliGuardError,
    );
  });

  it.each([
    ["migrate", "deploy"],
    ["migrate", "status"],
    ["migrate", "diff", "--from-config-datasource"],
    ["db", "seed"],
    ["validate"],
    ["generate"],
  ])("allows %j against a remote database", (...args) => {
    expect(() => assertPrismaCommandAllowed(args, neon)).not.toThrow();
  });

  it("allows every command against the local database", () => {
    for (const args of [
      ["migrate", "dev"],
      ["migrate", "reset"],
      ["db", "push"],
    ]) {
      expect(() => assertPrismaCommandAllowed(args, local)).not.toThrow();
    }
  });

  it("does nothing without a database URL (prisma generate on install)", () => {
    expect(() =>
      assertPrismaCommandAllowed(["migrate", "dev"], undefined),
    ).not.toThrow();
  });

  it("names the host but never the credentials", () => {
    expect(() =>
      assertPrismaCommandAllowed(["migrate", "reset"], neon),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /ep-quiet-1234\.eu-central-1\.aws\.neon\.tech/,
        ),
      }),
    );
    expect(() =>
      assertPrismaCommandAllowed(["migrate", "reset"], neon),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("npg-secret"),
      }),
    );
  });
});
