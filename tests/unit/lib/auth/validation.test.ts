import { describe, expect, it } from "vitest";

import { adminPasswordSchema, inviteAdminSchema } from "@/lib/validation/admin";

describe("admin password policy", () => {
  it.each([
    "abcdefghijkl",
    "correct horse battery staple",
    "  leading and trailing  ",
    "åäö-ÅÄÖ-🔐-pässwörd",
    "x".repeat(128),
  ])("accepts %j without composition rules", (password) => {
    expect(adminPasswordSchema.parse(password)).toBe(password);
  });

  it.each(["", "short", "elevenchars", "x".repeat(129)])(
    "rejects %j by length",
    (password) => {
      expect(adminPasswordSchema.safeParse(password).success).toBe(false);
    },
  );
});

describe("invitation input", () => {
  it("normalizes the email and trims the name", () => {
    expect(
      inviteAdminSchema.parse({
        name: "  Anna  ",
        email: " Anna@Example.COM ",
      }),
    ).toEqual({ name: "Anna", email: "anna@example.com" });
  });

  it("drops any posted role", () => {
    expect(
      inviteAdminSchema.parse({
        name: "Anna",
        email: "anna@example.com",
        role: "OWNER",
      }),
    ).not.toHaveProperty("role");
  });

  it.each([
    { name: "", email: "anna@example.com" },
    { name: "Anna", email: "inte-en-adress" },
    { name: "x".repeat(121), email: "anna@example.com" },
  ])("rejects %j", (input) => {
    expect(inviteAdminSchema.safeParse(input).success).toBe(false);
  });
});
