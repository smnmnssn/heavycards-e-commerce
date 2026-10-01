import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationEmail, passwordResetEmail } from "@/lib/email/templates";
import {
  createEmailTransport,
  createMemoryTransport,
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
        from: "x@example.com",
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
