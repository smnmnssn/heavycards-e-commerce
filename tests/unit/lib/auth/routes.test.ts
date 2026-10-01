import { describe, expect, it } from "vitest";

import {
  isPublicAdminPath,
  loginUrlFor,
  safeAdminRedirect,
} from "@/lib/auth/routes";

describe("safeAdminRedirect", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/users", "/admin/users"],
    ["/admin/users?tab=invites#list", "/admin/users?tab=invites#list"],
  ])("keeps the protected admin path %j", (next, expected) => {
    expect(safeAdminRedirect(next)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "admin/users",
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\evil.example/admin",
    "\\evil.example",
    "/admin\..\evil",
    "javascript:alert(1)",
    "/%2F%2Fevil.example",
    "/admin/../pokemon-tcg",
    "/",
    "/administrator",
    "/admin\u0000",
    "/admin/login",
    "/admin/login?next=/admin/users",
    "/admin/reset-password?token=abc",
    "/admin/invite?token=abc",
    `/admin/${"a".repeat(3000)}`,
  ])("falls back to /admin for %j", (next) => {
    expect(safeAdminRedirect(next)).toBe("/admin");
  });
});

describe("isPublicAdminPath", () => {
  it.each([
    "/admin/login",
    "/admin/forgot-password",
    "/admin/reset-password",
    "/admin/invite",
  ])("treats %j as public", (path) => {
    expect(isPublicAdminPath(path)).toBe(true);
  });

  it.each(["/admin", "/admin/users", "/admin/loginx", "/admin/invites"])(
    "treats %j as protected",
    (path) => {
      expect(isPublicAdminPath(path)).toBe(false);
    },
  );
});

describe("loginUrlFor", () => {
  it("returns to protected pages after login", () => {
    expect(loginUrlFor("/admin/users?x=1")).toBe(
      "/admin/login?next=%2Fadmin%2Fusers%3Fx%3D1",
    );
  });

  it("omits next for the dashboard and unsafe paths", () => {
    expect(loginUrlFor("/admin")).toBe("/admin/login");
    expect(loginUrlFor("//evil.example")).toBe("/admin/login");
    expect(loginUrlFor("")).toBe("/admin/login");
  });
});
