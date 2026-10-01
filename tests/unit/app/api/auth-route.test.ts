import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.fn(async () => new Response("ok"));
vi.mock("@/lib/auth/server", () => ({ auth: { handler } }));

const { GET, POST } = await import("@/app/api/auth/[...all]/route");

const request = (path: string, method = "POST") =>
  new Request(`http://localhost:3000/api/auth${path}`, { method });

describe("/api/auth allowlist", () => {
  beforeEach(() => handler.mockClear());

  it.each([
    ["POST", "/sign-in/email"],
    ["POST", "/sign-out"],
    ["GET", "/get-session"],
    ["POST", "/request-password-reset"],
    ["POST", "/reset-password"],
  ])("forwards %s %s to Better Auth", async (method, path) => {
    const response = await (method === "GET" ? GET : POST)(
      request(path, method),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    "/sign-up/email",
    "/update-user",
    "/change-email",
    "/change-password",
    "/delete-user",
    "/sign-in/social",
    "/link-social",
    "/list-sessions",
    "/reset-password/some-token",
    "/callback/github",
    "/admin/create-user",
    "/sign-in/email/",
    "/SIGN-IN/EMAIL",
  ])("answers 404 for %s without reaching Better Auth", async (path) => {
    for (const method of ["GET", "POST"] as const) {
      const response = await (method === "GET" ? GET : POST)(
        request(path, method),
      );
      expect(response.status).toBe(404);
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
