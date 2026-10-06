import { createServer } from "node:http";
import { resolve } from "node:path";

import { TaskWorker } from "./worker.js";
import { E2BSessionManager } from "./e2b-session-manager.js";
import { localBridgeKey, validBridgeKey } from "@nimbus/codex";

const port = Number(process.env.EXECUTOR_PORT ?? "3020");
const host = process.env.EXECUTOR_HOST ?? "127.0.0.1";
const repositoryRoot = resolve(process.cwd(), "../..");
const sessions = process.env.E2B_API_KEY?.trim()
  ? new E2BSessionManager(repositoryRoot)
  : undefined;
const worker = new TaskWorker(repositoryRoot, sessions);
const bridgeKey = await localBridgeKey(repositoryRoot);

const server = createServer(async (request, response) => {
  const match = /^\/internal\/workspace\/(task_[a-f0-9]{32})$/.exec(
    request.url ?? "",
  );
  if (match && request.method === "POST") {
    if (
      !validBridgeKey(
        String(request.headers["x-nimbus-executor-key"] ?? ""),
        bridgeKey,
      )
    ) {
      response.writeHead(401).end();
      return;
    }
    if (!sessions) {
      response.writeHead(503).end(
        JSON.stringify({
          error: "E2B is not configured; local fallback is forbidden",
        }),
      );
      return;
    }
    try {
      let data = "";
      for await (const chunk of request) {
        data += chunk;
        if (data.length > 4096) throw new Error("Invalid workspace request");
      }
      const { operation } = JSON.parse(data);
      let result: unknown = {};
      if (operation === "ensure") {
        const session = await sessions.ensure(match[1]!);
        result = {
          environmentId: session.environmentId,
          execServerUrl: session.url,
          authBearerToken: session.token,
          restored: session.restored,
        };
      } else if (operation === "sync") await sessions.sync(match[1]!);
      else if (operation === "published") await sessions.published(match[1]!);
      else if (operation === "idle") await sessions.idle(match[1]!);
      else throw new Error("Invalid workspace operation");
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" }).end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Remote workspace failed",
        }),
      );
    }
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        provider: process.env.NIMBUS_CODING_PROVIDER,
        time: new Date().toISOString(),
      }),
    );
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(port, host, resolve));
console.log(`Nimbus executor listening on ${host}:${String(port)}`);
await worker.start();

const shutdown = async () => {
  server.close();
  await worker.stop();
  await sessions?.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
