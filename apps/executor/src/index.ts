import { createServer } from "node:http";
import { resolve } from "node:path";

import { TaskWorker } from "./worker.js";

const port = Number(process.env.EXECUTOR_PORT ?? "3020");
const repositoryRoot = resolve(process.cwd(), "../..");
const worker = new TaskWorker(repositoryRoot);
await worker.start();

const server = createServer((request, response) => {
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
server.listen(port, "0.0.0.0", () =>
  console.log(`Nimbus executor listening on http://localhost:${String(port)}`),
);

const shutdown = async () => {
  server.close();
  await worker.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
