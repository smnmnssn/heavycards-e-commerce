/**
 * Creates the first OWNER administrator.
 *
 *   npm run admin:create-owner -- --email owner@example.com --name "Förnamn Efternamn"
 *
 * The password is read from a hidden prompt (asked twice), or from the first
 * line of standard input when it is not a terminal. It is never accepted as a
 * command-line argument (shell history, process lists) and never printed.
 *
 * Refuses to run when an active OWNER already exists: further administrators
 * are invited from /admin/users. See README → Admin access.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";

import { createPrismaClient } from "@/lib/db/create-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { bootstrapOwner } from "@/server/admin/bootstrap";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Reads a line from the terminal without echoing it. Paste works. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Avbrutet."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/, 1)[0] ?? "";
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readPiped();
  const first = await promptHidden(
    `Lösenord (minst ${MIN_PASSWORD_LENGTH} tecken): `,
  );
  const second = await promptHidden("Upprepa lösenordet: ");
  if (first !== second) fail("Lösenorden matchar inte.");
  return first;
}

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
  strict: true,
});
if (!values.email || !values.name) {
  fail(
    'Ange --email och --name, t.ex. npm run admin:create-owner -- --email owner@example.com --name "Ditt namn"',
  );
}
if (!process.env.DATABASE_URL) fail("DATABASE_URL är inte satt.");

const password = await readPassword();
const db = createPrismaClient(process.env.DATABASE_URL);
try {
  const result = await bootstrapOwner(db, {
    name: values.name,
    email: values.email,
    password,
    hashPassword,
  });
  if (!result.ok) fail(result.message);
  console.info(
    `✓ Ägarkontot ${result.email} är skapat. Logga in på /admin/login.`,
  );
} finally {
  await db.$disconnect();
}
