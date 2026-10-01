import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { ADMIN_PATH_HEADER } from "@/lib/auth/routes";
import { config, proxy } from "@/proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });

describe("admin proxy", () => {
  it("only runs for admin paths", () => {
    expect(config.matcher).toEqual(["/admin", "/admin/:path*"]);
  });

  it("redirects anonymous visitors to the login page with a return path", () => {
    const response = proxy(request("/admin/users?x=1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/admin/login?next=%2Fadmin%2Fusers%3Fx%3D1",
    );
  });

  it("redirects the dashboard without a next parameter", () => {
    expect(proxy(request("/admin")).headers.get("location")).toBe(
      "http://localhost:3000/admin/login",
    );
  });

  it.each([
    "/admin/login",
    "/admin/forgot-password",
    "/admin/reset-password?token=abc",
    "/admin/invite?token=abc",
  ])("lets %s through without a session", (path) => {
    expect(proxy(request(path)).headers.get("location")).toBeNull();
  });

  it.each([
    "heavycards-admin.session_token=abc.def",
    "__Secure-heavycards-admin.session_token=abc.def",
  ])("passes requests with a session cookie on (%s)", (cookie) => {
    const response = proxy(request("/admin/users", cookie));

    expect(response.headers.get("location")).toBeNull();
    expect(
      response.headers.get(`x-middleware-request-${ADMIN_PATH_HEADER}`),
    ).toBe("/admin/users");
  });

  it("ignores cookies from other applications", () => {
    const response = proxy(
      request("/admin", "better-auth.session_token=abc.def"),
    );
    expect(response.status).toBe(307);
  });
});
