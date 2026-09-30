/**
 * Runs once when a Next.js server instance starts. Validating the environment
 * here makes a misconfigured deployment fail immediately at boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { parseServerEnv } = await import("./lib/env/schema");
    parseServerEnv(process.env);
  }
}
