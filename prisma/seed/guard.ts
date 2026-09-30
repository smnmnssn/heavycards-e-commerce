/**
 * The development seed creates demo products, fictional customers and a
 * password-less development OWNER. It must never run against production.
 *
 * Rules:
 * - refuse outright in production (NODE_ENV or VERCEL_ENV);
 * - allow local databases (localhost / loopback);
 * - allow any other host only with SEED_ALLOW_REMOTE_DATABASE=true, which is
 *   meant for disposable staging/preview databases.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedGuardError";
  }
}

export function assertSeedAllowed(
  environment: Record<string, string | undefined>,
): void {
  if (
    environment.NODE_ENV === "production" ||
    environment.VERCEL_ENV === "production"
  ) {
    throw new SeedGuardError(
      "Refusing to seed: production environment detected.",
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new SeedGuardError("Refusing to seed: DATABASE_URL is not set.");
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new SeedGuardError("Refusing to seed: DATABASE_URL is not a URL.");
  }

  if (
    !LOCAL_HOSTS.has(hostname) &&
    environment.SEED_ALLOW_REMOTE_DATABASE !== "true"
  ) {
    // The hostname is safe to print; credentials are not.
    throw new SeedGuardError(
      `Refusing to seed non-local database host "${hostname}". ` +
        "Set SEED_ALLOW_REMOTE_DATABASE=true only for disposable staging databases.",
    );
  }
}
