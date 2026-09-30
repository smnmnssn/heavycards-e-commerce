/**
 * Liveness check for uptime monitoring. Deliberately reveals nothing about the
 * runtime, versions or configuration. A database readiness check is added
 * together with the database in Milestone 2.
 */
export function GET(): Response {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
