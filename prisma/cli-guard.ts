import { databaseHost, isLocalDatabaseHost } from "./seed/guard";

/**
 * Prisma CLI commands that may drop data or change the schema outside the
 * reviewed migration history. They are for the local development database
 * only; deployments apply migrations with `npm run db:deploy`
 * (`prisma migrate deploy`), which never resets anything.
 */
const LOCAL_ONLY_COMMANDS = ["migrate dev", "migrate reset", "db push"];

export class PrismaCliGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrismaCliGuardError";
  }
}

/**
 * Called from prisma.config.ts with the CLI arguments
 * (`process.argv.slice(2)`, e.g. `["migrate", "dev", "--name", "x"]`).
 * Refuses a local-only command against any non-local database host, so a
 * production DATABASE_URL left in a shell cannot be reset by
 * `npm run db:migrate` or `npm run db:reset`.
 */
export function assertPrismaCommandAllowed(
  args: readonly string[],
  databaseUrl: string | undefined,
): void {
  // Global options may precede the command (`--schema <path> migrate dev`).
  const command = args
    .slice(0, -1)
    .map((arg, index) => `${arg} ${args[index + 1]}`)
    .find((pair) => LOCAL_ONLY_COMMANDS.includes(pair));
  if (!command || !databaseUrl) return;

  const hostname = databaseHost(databaseUrl);
  if (hostname && isLocalDatabaseHost(hostname)) return;
  // The host name is safe to print; credentials are not.
  throw new PrismaCliGuardError(
    `Refusing "prisma ${command}" against the non-local database host "${hostname ?? "(invalid URL)"}". ` +
      "It is for the local development database only; deployments use npm run db:deploy.",
  );
}
