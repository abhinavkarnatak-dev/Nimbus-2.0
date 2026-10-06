import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import { listAvailableRepositories } from "@/lib/available-repositories";

export async function GET() {
  const identity = await currentIdentity();
  const headers = { "cache-control": "private, no-store" };
  if (!identity)
    return NextResponse.json(
      { error: "Sign in first" },
      { status: 401, headers },
    );
  const rows = await listAvailableRepositories(identity.organizationId);
  return NextResponse.json(
    { repositories: rows.map(({ id, fullName }) => ({ id, fullName })) },
    { headers },
  );
}
