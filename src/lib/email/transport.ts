import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Resend } from "resend";

import type { EmailConfig } from "@/lib/env/schema";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailTransport = {
  send(message: EmailMessage): Promise<void>;
};

export class EmailDeliveryError extends Error {
  constructor(reason: string) {
    super(`Email delivery failed: ${reason}`);
    this.name = "EmailDeliveryError";
  }
}

/** `owner@example.com` → `o***@example.com`, for logs. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Creates the transport for the configured delivery mode. Messages carry
 * single-use links, so their bodies are only ever written to a log or file
 * outside production builds (`console`) or in explicit test mode (`file`).
 */
export function createEmailTransport(
  config: EmailConfig,
  { production }: { production: boolean },
): EmailTransport {
  switch (config.transport) {
    case "resend": {
      const resend = new Resend(config.resendApiKey);
      return {
        async send(message) {
          const { error } = await resend.emails.send({
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
          // Resend errors name the problem (domain, key, rate limit) and do
          // not echo the message body.
          if (error) throw new EmailDeliveryError(error.name);
        },
      };
    }
    case "file":
      return {
        async send(message) {
          await mkdir(config.outboxDir, { recursive: true });
          const file = join(
            config.outboxDir,
            `${Date.now()}-${randomUUID()}.json`,
          );
          await writeFile(
            file,
            JSON.stringify({ from: config.from, ...message }),
          );
        },
      };
    case "console":
      return {
        async send(message) {
          const summary = `[email:console] not sent; to=${maskEmail(message.to)} subject="${message.subject}"`;
          if (production) {
            console.info(summary);
          } else {
            // Development convenience: the link is needed to finish the flow.
            console.info(`${summary}\n${message.text}`);
          }
        },
      };
  }
}

/** Collects messages in memory. For tests. */
export function createMemoryTransport(): EmailTransport & {
  messages: EmailMessage[];
} {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
}
