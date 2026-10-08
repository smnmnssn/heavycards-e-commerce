/**
 * The development seed creates demo products, fictional customers and a
 * password-less development OWNER. It must never run against production.
 *
 * Rules:
 * - refuse outright in production (NODE_ENV or VERCEL_ENV);
 * - allow local databases (localhost / loopback);
 * - allow another host only when SEED_ALLOW_REMOTE_DATABASE names exactly
 *   that host (a disposable staging/preview database). A bare "true" is not
 *   enough: an opt-in left in a shell must not carry over to another
 *   database, such as production (Milestone 15);
 * - on a remote host, also refuse when the database already has a real
 *   administrator (assertNoRealAdministrators): only production and real
 *   staging setups have one, the seed's and the tests' use `.test`.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedGuardError";
  }
}

/** Host name of a connection URL; null when it is not a URL. */
export function databaseHost(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

export function isLocalDatabaseHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

/** Returns the target host; throws when seeding it is not allowed. */
export function assertSeedAllowed(
  environment: Record<string, string | undefined>,
): { hostname: string; local: boolean } {
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

  const hostname = databaseHost(databaseUrl);
  if (!hostname) {
    throw new SeedGuardError("Refusing to seed: DATABASE_URL is not a URL.");
  }
  if (isLocalDatabaseHost(hostname)) return { hostname, local: true };

  if (environment.SEED_ALLOW_REMOTE_DATABASE !== hostname) {
    // The hostname is safe to print; credentials are not.
    throw new SeedGuardError(
      `Refusing to seed non-local database host "${hostname}". ` +
        "Only for a disposable staging database, set SEED_ALLOW_REMOTE_DATABASE to exactly this host name.",
    );
  }
  return { hostname, local: false };
}

/**
 * Remote targets only: refuses when an administrator outside the reserved
 * `.test` domain exists. Development and E2E administrators all use `.test`
 * addresses; a production database has its real OWNER.
 */
export async function assertNoRealAdministrators(db: {
  adminUser: {
    count(args: {
      where: { NOT: { email: { endsWith: string } } };
    }): Promise<number>;
  };
}): Promise<void> {
  const real = await db.adminUser.count({
    where: { NOT: { email: { endsWith: ".test" } } },
  });
  if (real > 0) {
    throw new SeedGuardError(
      "Refusing to seed: this database has real administrators, so it is not a disposable development database.",
    );
  }
}
