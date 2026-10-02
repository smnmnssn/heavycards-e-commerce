/**
 * Operator commands for situations the admin UI deliberately cannot resolve
 * (docs/production-readiness.md → Runbooks). Each command:
 *
 * - authenticates an active OWNER with their admin password (hidden prompt,
 *   terminal only; never an argument),
 * - shows what it found and asks the operator to type the order number,
 * - re-checks everything inside its own transaction and writes an audit
 *   entry naming that OWNER.
 *
 *   npm run ops -- release-payment-hold --order HC-10001 --owner owner@heavycards.se --note "…"
 *   npm run ops -- requeue-email --order HC-10001 --kind confirmation|shipped --owner owner@heavycards.se
 *
 * It uses DATABASE_URL (and STRIPE_SECRET_KEY for release-payment-hold) from
 * the environment, falling back to .env.local. Against production, run it
 * with the production values from a trusted machine; never commit them.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { verifyPassword } from "better-auth/crypto";

import type { EmailKind } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db/create-client";
import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import type { CheckoutGateway } from "@/server/checkout/gateway";
import { StripeCheckoutGateway } from "@/server/checkout/stripe-gateway";
import { requeueFailedEmail } from "@/server/operations/email-requeue";
import { authenticateOwner } from "@/server/operations/operator-auth";
import {
  assessPaymentHold,
  parseOrderNumber,
  releasePaymentHold,
} from "@/server/operations/payment-hold";
import { formatOrderNumber } from "@/server/domain/order-number";

import { promptHidden, promptLine } from "./lib/terminal";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const USAGE = `Användning:
  npm run ops -- release-payment-hold --order HC-10001 --owner <e-post> --note "<kort anteckning utan kunddata>"
  npm run ops -- requeue-email --order HC-10001 --kind confirmation|shipped --owner <e-post>`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    order: { type: "string" },
    owner: { type: "string" },
    note: { type: "string" },
    kind: { type: "string" },
  },
  strict: true,
});

const orderNumber = parseOrderNumber(values.order ?? "");
if (!command || orderNumber === null || !values.owner) fail(USAGE);
if (!process.env.DATABASE_URL) fail("DATABASE_URL är inte satt.");
if (!process.stdin.isTTY) {
  fail("Kör kommandot i en terminal: lösenord och bekräftelse skrivs in.");
}
const label = formatOrderNumber(orderNumber);

function gatewayFromEnv(): CheckoutGateway {
  if (process.env.PAYMENT_GATEWAY === "fake") {
    if (process.env.VERCEL_ENV)
      fail("PAYMENT_GATEWAY=fake är bara för lokala tester.");
    return new FakeCheckoutGateway(process.env.FAKE_STRIPE_STATE_DIR || null);
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) fail("STRIPE_SECRET_KEY är inte satt.");
  return StripeCheckoutGateway.fromSecretKey(key);
}

async function confirm(summary: string[]): Promise<void> {
  console.info(summary.join("\n"));
  const answer = await promptLine(
    `\nSkriv ordernumret (${label}) för att fortsätta, eller tryck Enter för att avbryta: `,
  );
  if (answer.trim().toUpperCase() !== label) fail("Avbrutet. Inget ändrades.");
}

const db = createPrismaClient(process.env.DATABASE_URL);
try {
  const password = await promptHidden(`Lösenord för ${values.owner}: `);
  const actorId = await authenticateOwner(db, {
    email: values.owner,
    password,
    verifyPassword,
  });
  if (!actorId) {
    fail("Fel e-post eller lösenord, eller kontot är inte en aktiv ägare.");
  }

  switch (command) {
    case "release-payment-hold": {
      const note = values.note?.trim();
      if (!note)
        fail('Ange --note "…" (t.ex. var och när återbetalningen gjordes).');
      const deps = { db, gateway: gatewayFromEnv() };
      const assessment = await assessPaymentHold(deps, orderNumber);
      if (!assessment.ok) {
        fail(
          `${label} kan inte släppas: ${assessment.error}${
            assessment.detail ? ` (${assessment.detail})` : ""
          }. Se docs/production-readiness.md.`,
        );
      }
      const { evidence } = assessment;
      await confirm([
        `${label}: väntar på betalning och håller ${assessment.heldUnits} st i lager.`,
        `Problem: ${assessment.problems.join(", ")}`,
        evidence.kind === "refunded"
          ? `Stripe: ${evidence.refundedAmount} av ${evidence.chargedAmount} öre återbetalt (${evidence.paymentIntentId}).`
          : `Stripe: betalningen ${evidence.paymentIntentId} är avbruten (inga pengar dragna).`,
        "Reservationen släpps, beställningen avslutas som misslyckad (FAILED) och händelsen loggas med ditt konto.",
      ]);
      const result = await releasePaymentHold(deps, {
        actorId,
        orderNumber,
        note,
      });
      if (!result.ok) fail(`Inget ändrades: ${result.error}.`);
      console.info(
        `✓ ${label}: reservationen är släppt. Produktsidorna visar det inom 60 sekunder.`,
      );
      break;
    }
    case "requeue-email": {
      const kinds: Record<string, EmailKind> = {
        confirmation: "ORDER_CONFIRMATION",
        shipped: "ORDER_SHIPPED",
      };
      const kind = kinds[values.kind ?? ""];
      if (!kind) fail("Ange --kind confirmation eller --kind shipped.");
      await confirm([
        `${label}: e-postmeddelandet (${values.kind}) läggs i kö för ett nytt automatiskt utskick.`,
        "Gör detta bara om Resend-loggen visar att det INTE levererades.",
      ]);
      const result = await requeueFailedEmail(db, {
        actorId,
        orderNumber,
        kind,
      });
      if (!result.ok) {
        fail(
          `Inget ändrades: ${result.error}${result.detail ? ` (${result.detail})` : ""}.`,
        );
      }
      console.info(
        `✓ ${label}: i kö. Det skickas vid nästa schemalagda körning eller kassahändelse.`,
      );
      break;
    }
    default:
      fail(USAGE);
  }
} finally {
  await db.$disconnect();
}
