import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAdminSession } from "@/lib/auth/authorization";
import { SESSION_TTL_SECONDS } from "@/lib/auth/policy";
import { setAdminActive } from "@/server/admin/admin-users";

import {
  authRequest,
  cookieHeaderFrom,
  cookieHeaders,
  createAdmin,
  createTestAuth,
  randomPassword,
  signIn,
  uniqueIp,
} from "./auth-helpers";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const { auth, resets } = createTestAuth(db);

beforeEach(async () => {
  await resetDatabase(db);
  resets.length = 0;
});
afterAll(() => db.$disconnect());

// Better Auth's body for a wrong password, key order included.
const INVALID_CREDENTIALS = {
  message: "Invalid email or password",
  code: "INVALID_EMAIL_OR_PASSWORD",
};

describe("sign-in", () => {
  it("signs in an active administrator with a secure session cookie", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { role: "OWNER", password });

    const before = Date.now();
    const response = await signIn(auth, admin.email, password);

    expect(response.status).toBe(200);
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^heavycards-admin\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);

    const session = await db.adminSession.findFirstOrThrow({
      where: { userId: admin.id },
    });
    const lifetime = session.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan((SESSION_TTL_SECONDS - 60) * 1000);
    expect(lifetime).toBeLessThanOrEqual((SESSION_TTL_SECONDS + 60) * 1000);
  });

  it("uses __Secure- cookies when the site is served over HTTPS", async () => {
    const baseURL = "https://heavycards.example";
    const { auth: httpsAuth } = createTestAuth(db, { baseURL });
    const password = randomPassword();
    const admin = await createAdmin(db, { password });

    const response = await httpsAuth.handler(
      authRequest("/sign-in/email", {
        body: { email: admin.email, password },
        baseURL,
        origin: baseURL,
      }),
    );

    expect(response.status).toBe(200);
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^__Secure-heavycards-admin\.session_token=/);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("accepts the email in any letter case", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });

    const response = await signIn(auth, admin.email.toUpperCase(), password);

    expect(response.status).toBe(200);
  });

  it("gives the same answer for a wrong password, an unknown email and an inactive account", async () => {
    const password = randomPassword();
    const active = await createAdmin(db, { password });
    const inactive = await createAdmin(db, { password, isActive: false });
    const noCredential = await createAdmin(db);

    const responses = await Promise.all([
      signIn(auth, active.email, randomPassword()),
      signIn(auth, "nobody@heavycards.test", password),
      signIn(auth, inactive.email, password),
      signIn(auth, noCredential.email, password),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.text()).toBe(JSON.stringify(INVALID_CREDENTIALS));
    }
    expect(await db.adminSession.count()).toBe(0);
  });

  it.each([
    [
      "a cross-site fetch",
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
    ],
    [
      "a cross-site form post",
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
    ],
  ])(
    "rejects sign-in from another origin via %s (CSRF)",
    async (_label, headers) => {
      const password = randomPassword();
      const admin = await createAdmin(db, { password });

      const response = await signIn(auth, admin.email, password, {
        origin: "https://evil.example",
        headers,
      });

      expect(response.status).toBe(403);
      expect(await db.adminSession.count()).toBe(0);
    },
  );

  it("rejects cookie-carrying requests from another origin (CSRF)", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));

    const response = await auth.handler(
      authRequest("/sign-out", { cookie, origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect(await db.adminSession.count()).toBe(1);
  });
});

describe("no public sign-up or profile changes", () => {
  it("does not create administrators through the sign-up endpoint", async () => {
    const response = await auth.handler(
      authRequest("/sign-up/email", {
        body: {
          name: "Angripare",
          email: "attacker@example.com",
          password: randomPassword(),
          role: "OWNER",
          isActive: true,
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(await db.adminUser.count()).toBe(0);
  });

  it("refuses sign-up even when called directly on the server API", async () => {
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "Angripare",
          email: "attacker@example.com",
          password: randomPassword(),
        },
      }),
    ).rejects.toThrow();
    expect(await db.adminUser.count()).toBe(0);
  });

  it("does not let a signed-in ADMIN change role or status", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));

    const response = await auth.handler(
      authRequest("/update-user", {
        body: { role: "OWNER", isActive: true, name: "Ny" },
        cookie,
      }),
    );

    expect(response.status).toBe(404);
    expect(
      await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } }),
    ).toMatchObject({ role: "ADMIN", name: admin.name });
  });
});

describe("server-side session resolution", () => {
  it("returns null without a session cookie or with a forged one", async () => {
    expect(await resolveAdminSession(auth, new Headers())).toBeNull();
    expect(
      await resolveAdminSession(
        auth,
        cookieHeaders("heavycards-admin.session_token=forged.value"),
      ),
    ).toBeNull();
  });

  it("resolves the identity and role from a valid session", async () => {
    const password = randomPassword();
    const owner = await createAdmin(db, { role: "OWNER", password });
    const cookie = cookieHeaderFrom(await signIn(auth, owner.email, password));

    const identity = await resolveAdminSession(auth, cookieHeaders(cookie));

    expect(identity).toMatchObject({
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: "OWNER",
    });
  });

  it("rejects an existing session as soon as the account is inactive", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));
    expect(
      await resolveAdminSession(auth, cookieHeaders(cookie)),
    ).not.toBeNull();

    // Even if the session row survived (e.g. a direct database change).
    await db.adminUser.update({
      where: { id: admin.id },
      data: { isActive: false },
    });

    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
  });

  it("deletes sessions when an OWNER deactivates the account", async () => {
    const password = randomPassword();
    const owner = await createAdmin(db, { role: "OWNER" });
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));

    await setAdminActive(db, {
      actorId: owner.id,
      targetId: admin.id,
      active: false,
    });

    expect(await db.adminSession.count({ where: { userId: admin.id } })).toBe(
      0,
    );
    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
    expect((await signIn(auth, admin.email, password)).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));

    await db.adminSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
  });

  it("signs out by deleting the session and clearing the cookie", async () => {
    const password = randomPassword();
    const admin = await createAdmin(db, { password });
    const cookie = cookieHeaderFrom(await signIn(auth, admin.email, password));

    const response = await auth.handler(authRequest("/sign-out", { cookie }));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(";")).toMatch(
      /heavycards-admin\.session_token=;.*Max-Age=0/,
    );
    expect(await db.adminSession.count()).toBe(0);
    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
  });
});

describe("password reset", () => {
  const requestReset = (email: string, ip?: string) =>
    auth.handler(
      authRequest("/request-password-reset", { body: { email }, ip }),
    );

  it("answers identically for known, unknown and inactive addresses", async () => {
    const active = await createAdmin(db, { password: randomPassword() });
    const inactive = await createAdmin(db, {
      password: randomPassword(),
      isActive: false,
    });

    const bodies = await Promise.all(
      [active.email, "nobody@heavycards.test", inactive.email].map(
        async (email) => {
          const response = await requestReset(email);
          expect(response.status).toBe(200);
          return response.text();
        },
      ),
    );

    expect(new Set(bodies).size).toBe(1);
    expect(resets.map((reset) => reset.user.email)).toEqual([active.email]);
  });

  it("stores the reset token only hashed", async () => {
    const admin = await createAdmin(db, { password: randomPassword() });
    await requestReset(admin.email);
    const [{ token }] = resets as [(typeof resets)[number]];

    const rows = await db.authVerification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("sets a new password once, revokes sessions and retires the old password", async () => {
    const oldPassword = randomPassword();
    const newPassword = randomPassword();
    const admin = await createAdmin(db, { password: oldPassword });
    const cookie = cookieHeaderFrom(
      await signIn(auth, admin.email, oldPassword),
    );
    await requestReset(admin.email);
    const [{ token }] = resets as [(typeof resets)[number]];

    const reset = await auth.handler(
      authRequest("/reset-password", { body: { token, newPassword } }),
    );
    expect(reset.status).toBe(200);

    expect(await resolveAdminSession(auth, cookieHeaders(cookie))).toBeNull();
    expect((await signIn(auth, admin.email, oldPassword)).status).toBe(401);
    expect((await signIn(auth, admin.email, newPassword)).status).toBe(200);

    const reuse = await auth.handler(
      authRequest("/reset-password", {
        body: { token, newPassword: randomPassword() },
      }),
    );
    expect(reuse.status).toBe(400);
    expect((await signIn(auth, admin.email, newPassword)).status).toBe(200);
  });

  it("rejects expired tokens and too-short passwords", async () => {
    const admin = await createAdmin(db, { password: randomPassword() });
    await requestReset(admin.email);
    const [{ token }] = resets as [(typeof resets)[number]];

    const short = await auth.handler(
      authRequest("/reset-password", {
        body: { token, newPassword: "elevenchars" },
      }),
    );
    expect(short.status).toBe(400);

    await db.authVerification.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await auth.handler(
      authRequest("/reset-password", {
        body: { token, newPassword: randomPassword() },
      }),
    );
    expect(expired.status).toBe(400);
  });

  it("deactivation discards pending reset tokens", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });
    const admin = await createAdmin(db, { password: randomPassword() });
    await requestReset(admin.email);

    await setAdminActive(db, {
      actorId: owner.id,
      targetId: admin.id,
      active: false,
    });

    expect(await db.authVerification.count()).toBe(0);
  });
});

describe("rate limiting", () => {
  it("limits sign-in attempts per client IP in the shared database store", async () => {
    const admin = await createAdmin(db, { password: randomPassword() });
    const ip = uniqueIp();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await signIn(auth, admin.email, randomPassword(), {
        ip,
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
    expect(await db.authRateLimit.count()).toBeGreaterThan(0);

    // Another client is unaffected.
    expect(
      (await signIn(auth, admin.email, randomPassword(), { ip: uniqueIp() }))
        .status,
    ).toBe(401);
  });

  it("limits password-reset requests", async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await auth.handler(
        authRequest("/request-password-reset", {
          body: { email: "nobody@heavycards.test" },
          ip,
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("logging", () => {
  it("never logs passwords, session tokens or reset tokens", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const password = randomPassword();
    const admin = await createAdmin(db, { password });

    const signedIn = await signIn(auth, admin.email, password);
    const cookie = cookieHeaderFrom(signedIn);
    await signIn(auth, admin.email, `${password}-wrong`);
    await signIn(auth, "nobody@heavycards.test", password);
    await auth.handler(
      authRequest("/request-password-reset", { body: { email: admin.email } }),
    );
    const [{ token }] = resets as [(typeof resets)[number]];
    await auth.handler(
      authRequest("/reset-password", {
        body: { token, newPassword: randomPassword() },
      }),
    );

    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join("\n");
    const sessionToken = cookie.split("=")[1]!.split(".")[0]!;
    for (const secret of [password, token, sessionToken]) {
      expect(logged).not.toContain(secret);
    }
  });
});
