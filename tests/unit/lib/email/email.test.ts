import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationEmail, passwordResetEmail } from "@/lib/email/templates";
import {
  classifyResendError,
  createEmailTransport,
  createMemoryTransport,
  EmailDeliveryError,
  maskEmail,
} from "@/lib/email/transport";

const LINK = "https://heavycards.se/admin/invite?token=RAW-TOKEN-VALUE";
const message = {
  to: "anna@example.com",
  subject: "Ämne",
  text: `Länk: ${LINK}`,
  html: `<a href="${LINK}">Länk</a>`,
};

describe("email templates", () => {
  it("builds the invitation with the link and escapes HTML", () => {
    const email = invitationEmail({
      to: "anna@example.com",
      name: "<Anna>",
      inviterName: "Ägare & Co",
      url: LINK,
      expiresAt: new Date("2026-10-04T10:00:00Z"),
    });

    expect(email.subject).toBe("Inbjudan till HeavyCards admin");
    expect(email.text).toContain(LINK);
    expect(email.text).toContain("4 oktober 2026");
    expect(email.html).toContain("&lt;Anna&gt;");
    expect(email.html).toContain("Ägare &amp; Co");
    expect(email.html).not.toContain("<Anna>");
  });

  it("builds the password reset email", () => {
    const email = passwordResetEmail({
      to: "anna@example.com",
      name: "Anna",
      url: LINK,
    });

    expect(email.subject).toContain("Återställ");
    expect(email.text).toContain(LINK);
    expect(email.html).toContain("Välj nytt lösenord");
  });
});

describe("email transports", () => {
  afterEach(() => vi.restoreAllMocks());

  it("masks addresses for logs", () => {
    expect(maskEmail("anna@example.com")).toBe("a***@example.com");
  });

  it("console transport never logs the message body in production", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const transport = createEmailTransport(
      { transport: "console", from: "x@example.com" },
      { production: true },
    );

    await transport.send(message);

    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("a***@example.com");
    expect(logged).not.toContain("RAW-TOKEN-VALUE");
    expect(logged).not.toContain("anna@example.com");
  });

  it("console transport shows the link in development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const transport = createEmailTransport(
      { transport: "console", from: "x@example.com" },
      { production: false },
    );

    await transport.send(message);

    expect(info.mock.calls.flat().join(" ")).toContain(LINK);
  });

  it("file transport writes each message as JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "heavycards-outbox-"));
    try {
      const transport = createEmailTransport(
        { transport: "file", from: "x@example.com", outboxDir: dir },
        { production: true },
      );
      await transport.send(message);

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(join(dir, files[0]!), "utf8"))).toEqual({
        id: expect.stringMatching(/^file_/),
        from: "x@example.com",
        idempotencyKey: null,
        ...message,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memory transport collects messages", async () => {
    const transport = createMemoryTransport();
    await transport.send(message);
    expect(transport.messages).toEqual([message]);
  });
});

describe("Resend transport (Milestone 10)", () => {
  const API_KEY = "re_unit_SECRET_api_key";
  const config = {
    transport: "resend" as const,
    from: "HeavyCards <order@heavycards.se>",
    resendApiKey: API_KEY,
  };
  const orderMessage = {
    to: "kim@example.com",
    subject: "Orderbekräftelse HC-10001",
    text: "Hej Kim Kund, Testgatan 1",
    html: "<p>Hej Kim Kund</p>",
    replyTo: "kundservice@heavycards.se",
    personalData: true,
  };

  function mockFetch(response: () => Promise<Response>) {
    vi.spyOn(console, "error").mockImplementation(() => {});
    return vi.spyOn(globalThis, "fetch").mockImplementation(response);
  }
  const json = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  afterEach(() => vi.restoreAllMocks());

  it("sends with the idempotency key and returns Resend's email ID", async () => {
    const fetch = mockFetch(json(200, { id: "re_email_123" }));
    const transport = createEmailTransport(config, { production: true });

    const result = await transport.send(orderMessage, {
      idempotencyKey: "order-confirmation/0192-abc",
    });

    expect(result).toEqual({ providerMessageId: "re_email_123" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/emails$/);
    const headers = new Headers(init!.headers);
    expect(headers.get("idempotency-key")).toBe("order-confirmation/0192-abc");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      from: config.from,
      to: "kim@example.com",
      subject: "Orderbekräftelse HC-10001",
      reply_to: "kundservice@heavycards.se",
    });
    // Our own flag never reaches the provider.
    expect(String(init!.body)).not.toContain("personalData");
  });

  it.each([
    [500, "internal_server_error", "unknown"],
    [503, "application_error", "unknown"],
    [409, "concurrent_idempotent_requests", "unknown"],
    [409, "invalid_idempotent_request", "conflict"],
    [429, "rate_limit_exceeded", "not_sent"],
    [429, "daily_quota_exceeded", "not_sent"],
    [422, "validation_error", "not_sent"],
    [403, "invalid_from_address", "not_sent"],
    [401, "missing_api_key", "not_sent"],
  ])(
    "classifies HTTP %i %s as %s, without the key or recipient",
    async (status, name, failure) => {
      mockFetch(
        json(status, {
          statusCode: status,
          name,
          message: `Problem with kim@example.com using ${API_KEY}`,
        }),
      );
      const transport = createEmailTransport(config, { production: true });

      const error = await transport
        .send(orderMessage, { idempotencyKey: "k/1" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect(error).toMatchObject({ code: name, failure });
      const text = `${(error as Error).message} ${JSON.stringify(error)}`;
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain("kim@example.com");
    },
  );

  it("treats a network failure as an unknown outcome", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = createEmailTransport(config, { production: true });

    await expect(transport.send(orderMessage)).rejects.toMatchObject({
      code: "network_error",
      failure: "unknown",
    });
  });

  it("gives up waiting after the timeout: outcome unknown", async () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const transport = createEmailTransport(config, {
      production: true,
      timeoutMs: 20,
    });

    await expect(transport.send(orderMessage)).rejects.toMatchObject({
      code: "timeout",
      failure: "unknown",
    });
  });

  it("maps errors through classifyResendError", () => {
    expect(
      classifyResendError({ name: "application_error", statusCode: null }),
    ).toMatchObject({ code: "network_error", failure: "unknown" });
  });
});

describe("test transports honour idempotency keys (Milestone 10)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("memory transport delivers a key once and records every call", async () => {
    const transport = createMemoryTransport();

    const first = await transport.send(message, { idempotencyKey: "a/1" });
    const second = await transport.send(message, { idempotencyKey: "a/1" });
    await transport.send(message, { idempotencyKey: "a/2" });

    expect(second).toEqual(first);
    expect(transport.messages).toHaveLength(2);
    expect(transport.calls).toHaveLength(3);
  });

  it("memory transport can fail, or accept and then lose the response", async () => {
    const transport = createMemoryTransport();
    transport.queue(
      { fail: new EmailDeliveryError("rate_limit_exceeded", "not_sent") },
      { acceptThenFail: new EmailDeliveryError("timeout", "unknown") },
    );

    await expect(
      transport.send(message, { idempotencyKey: "k" }),
    ).rejects.toMatchObject({ failure: "not_sent" });
    expect(transport.messages).toHaveLength(0);
    await expect(
      transport.send(message, { idempotencyKey: "k" }),
    ).rejects.toMatchObject({ failure: "unknown" });
    expect(transport.messages).toHaveLength(1);
    // The retry with the same key is answered without a second delivery.
    await transport.send(message, { idempotencyKey: "k" });
    expect(transport.messages).toHaveLength(1);
  });

  it("file transport writes a keyed message once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "heavycards-outbox-"));
    try {
      const transport = createEmailTransport(
        { transport: "file", from: "x@example.com", outboxDir: dir },
        { production: true },
      );
      const key = "order-confirmation/0192f0c1-aaaa-7bbb-8ccc-123456789abc";
      const first = await transport.send(message, { idempotencyKey: key });
      const second = await transport.send(message, { idempotencyKey: key });

      expect(second).toEqual(first);
      const files = await readdir(dir);
      expect(files).toEqual([
        "key-order-confirmation_0192f0c1-aaaa-7bbb-8ccc-123456789abc.json",
      ]);
      expect(
        JSON.parse(await readFile(join(dir, files[0]!), "utf8")),
      ).toMatchObject({ idempotencyKey: key, to: message.to });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("console transport never logs an order email's body, even in development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const transport = createEmailTransport(
      { transport: "console", from: "x@example.com" },
      { production: false },
    );

    await transport.send(
      { ...message, text: "Kim Kund, Testgatan 1", personalData: true },
      { idempotencyKey: "order-confirmation/1" },
    );

    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("key=order-confirmation/1");
    expect(logged).not.toContain("Testgatan");
    expect(logged).not.toContain("anna@example.com");
  });
});
