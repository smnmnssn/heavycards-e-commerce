import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Resend } from "resend";

import type { EmailConfig } from "@/lib/env/schema";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where customer replies go (customer service). */
  replyTo?: string;
  /**
   * The body contains customer personal data (order emails). It is then
   * never written to a log, not even by the development console transport.
   */
  personalData?: boolean;
};

export type SendOptions = {
  /**
   * Provider idempotency key. Resend returns the original result for a
   * repeated key (within 24 hours) instead of sending again.
   */
  idempotencyKey?: string;
};

export type SendResult = {
  /** The provider's ID of the accepted email (Resend email ID). */
  providerMessageId: string | null;
};

export type EmailTransport = {
  send(message: EmailMessage, options?: SendOptions): Promise<SendResult>;
};

/**
 * What a failed send means for retrying:
 * - `not_sent`: the provider definitely did not accept it (validation,
 *   authentication, rate limit). Retrying is safe.
 * - `unknown`: it may have been accepted (timeout, network error, provider
 *   5xx, a concurrent request with the same key). Retrying is only safe
 *   with the same idempotency key while the provider still remembers it.
 * - `conflict`: the provider already saw this idempotency key with a
 *   different message. Never retried automatically.
 */
export type DeliveryFailure = "not_sent" | "unknown" | "conflict";

export class EmailDeliveryError extends Error {
  constructor(
    /** Safe code for logs and storage (a provider error name), never a message. */
    readonly code: string,
    readonly failure: DeliveryFailure = "unknown",
  ) {
    super(`Email delivery failed: ${code}`);
    this.name = "EmailDeliveryError";
  }
}

/** `owner@example.com` → `o***@example.com`, for logs. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Longest a provider call may take before its outcome counts as unknown. */
export const SEND_TIMEOUT_MS = 15_000;

/**
 * Maps a Resend error response to a retry decision. Resend reports network
 * failures as `application_error` without a status code.
 */
export function classifyResendError(error: {
  name: string;
  statusCode: number | null;
}): EmailDeliveryError {
  const { name, statusCode } = error;
  if (statusCode === null) {
    return new EmailDeliveryError("network_error", "unknown");
  }
  if (name === "invalid_idempotent_request") {
    return new EmailDeliveryError(name, "conflict");
  }
  if (name === "concurrent_idempotent_requests" || statusCode >= 500) {
    return new EmailDeliveryError(name, "unknown");
  }
  return new EmailDeliveryError(name, "not_sent");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EmailDeliveryError("timeout", "unknown")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Idempotency keys look like `order-confirmation/<uuid>`; safe as a filename. */
const keyFileName = (key: string) =>
  `key-${key.replaceAll(/[^A-Za-z0-9-]/g, "_")}.json`;

/**
 * Creates the transport for the configured delivery mode. Admin messages
 * carry single-use links, so bodies are only ever written to a log or file
 * outside production builds (`console`) or in explicit test mode (`file`);
 * order emails (`personalData`) never reach a log at all.
 */
export function createEmailTransport(
  config: EmailConfig,
  {
    production,
    timeoutMs = SEND_TIMEOUT_MS,
  }: { production: boolean; timeoutMs?: number },
): EmailTransport {
  switch (config.transport) {
    case "resend": {
      const resend = new Resend(config.resendApiKey);
      return {
        async send(message, options = {}) {
          const { data, error } = await withTimeout(
            resend.emails.send(
              {
                from: config.from,
                to: message.to,
                subject: message.subject,
                text: message.text,
                html: message.html,
                ...(message.replyTo && { replyTo: message.replyTo }),
              },
              options.idempotencyKey
                ? { idempotencyKey: options.idempotencyKey }
                : undefined,
            ),
            timeoutMs,
          );
          // Only the error's name and status are used: they identify the
          // problem (domain, key, rate limit) without echoing the message.
          if (error) throw classifyResendError(error);
          return { providerMessageId: data?.id ?? null };
        },
      };
    }
    case "file":
      return {
        async send(message, options = {}) {
          await mkdir(config.outboxDir, { recursive: true });
          const id = `file_${randomUUID()}`;
          const record = JSON.stringify({
            id,
            from: config.from,
            idempotencyKey: options.idempotencyKey ?? null,
            ...message,
          });
          if (!options.idempotencyKey) {
            await writeFile(
              join(config.outboxDir, `${Date.now()}-${randomUUID()}.json`),
              record,
            );
            return { providerMessageId: id };
          }
          // Like the provider: a repeated key returns the first result.
          const file = join(
            config.outboxDir,
            keyFileName(options.idempotencyKey),
          );
          try {
            await writeFile(file, record, { flag: "wx" });
            return { providerMessageId: id };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const existing = JSON.parse(await readFile(file, "utf8")) as {
              id: string;
            };
            return { providerMessageId: existing.id };
          }
        },
      };
    case "console":
      return {
        async send(message, options = {}) {
          const key = options.idempotencyKey
            ? ` key=${options.idempotencyKey}`
            : "";
          const summary = `[email:console] not sent; to=${maskEmail(message.to)} subject="${message.subject}"${key}`;
          if (production || message.personalData) {
            console.info(summary);
          } else {
            // Development convenience: the link is needed to finish the flow.
            console.info(`${summary}\n${message.text}`);
          }
          return { providerMessageId: null };
        },
      };
  }
}

type MemoryBehavior =
  | { fail: EmailDeliveryError }
  /** The provider accepts the email but the response is lost. */
  | { acceptThenFail: EmailDeliveryError };

/**
 * Collects messages in memory, for tests. Like Resend, a repeated
 * idempotency key returns the first result without delivering again;
 * `calls` records every request, so tests can tell HeavyCards' own
 * deduplication apart from the provider's.
 */
export function createMemoryTransport({
  delayMs = 0,
}: { delayMs?: number } = {}): EmailTransport & {
  messages: EmailMessage[];
  calls: Array<{ message: EmailMessage; idempotencyKey: string | null }>;
  /** Queues outcomes for the next calls (first in, first out). */
  queue(...behaviors: MemoryBehavior[]): void;
} {
  const messages: EmailMessage[] = [];
  const calls: Array<{ message: EmailMessage; idempotencyKey: string | null }> =
    [];
  const accepted = new Map<string, string>();
  const behaviors: MemoryBehavior[] = [];
  let sequence = 0;
  return {
    messages,
    calls,
    queue(...next) {
      behaviors.push(...next);
    },
    async send(message, options = {}) {
      const key = options.idempotencyKey ?? null;
      calls.push({ message, idempotencyKey: key });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const behavior = behaviors.shift();
      if (behavior && "fail" in behavior) throw behavior.fail;

      const known = key ? accepted.get(key) : undefined;
      const id = known ?? `mem_${++sequence}`;
      if (!known) {
        messages.push(message);
        if (key) accepted.set(key, id);
      }
      if (behavior) throw behavior.acceptThenFail;
      return { providerMessageId: id };
    },
  };
}
