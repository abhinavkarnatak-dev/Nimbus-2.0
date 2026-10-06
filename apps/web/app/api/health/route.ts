// Liveness only: never depends on authentication, database, or external services.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}

export function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
