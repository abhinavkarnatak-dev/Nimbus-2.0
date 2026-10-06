import { NextResponse } from "next/server";

export function skillOriginError(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (
      origin.host === request.headers.get("host") &&
      ["http:", "https:"].includes(origin.protocol)
    )
      return null;
  } catch {}
  return NextResponse.json(
    { error: "Invalid request origin" },
    { status: 403 },
  );
}
export async function readSkillBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Send skill content as JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing skill content");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 140000) {
        await reader.cancel();
        throw new Error("Skill content is too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}
