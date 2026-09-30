import { db } from "@/lib/db/client";

const headers = { "Cache-Control": "no-store" };

/**
 * Health check for uptime monitoring: 200 when the app can reach PostgreSQL,
 * 503 otherwise. Deliberately reveals nothing about the runtime, versions,
 * configuration or the underlying error; details go to the server log only.
 */
export async function GET(): Promise<Response> {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers });
  } catch (error) {
    console.error("[health] database check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
