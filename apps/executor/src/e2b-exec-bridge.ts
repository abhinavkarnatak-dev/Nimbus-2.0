import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";
import type { ManagedProcess, WorkspaceHandle } from "./workspace-provider.js";

/** Private loopback transport. Account/API credentials never enter the VM. */
export async function startE2BExecBridge(
  provider: E2BWorkspaceProvider,
  workspace: WorkspaceHandle,
  token: string,
  diagnostic?: (message: string) => void,
) {
  if (token.length < 32)
    throw new Error("Execution bridge requires a strong per-session token");
  provider.handle(workspace); // Fail closed before accepting connections.
  const server = createServer((_request, response) =>
    response.writeHead(404).end(),
  );
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
  });
  const processes = new Set<ManagedProcess>();
  let currentRequest: string | undefined;
  const stoppedRequests = new Set<string>();
  const requestProcesses = new Map<WebSocket, Map<string, string>>();
  const terminators = new Map<
    WebSocket,
    (processId: string) => Promise<void>
  >();
  server.on("upgrade", (request, socket, head) => {
    const authorization = request.headers.authorization ?? "";
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(authorization);
    if (
      request.url !== "/exec" ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      sockets.emit("connection", ws),
    );
  });
  sockets.on("connection", (ws) => {
    const owners = new Map<string, string>();
    requestProcesses.set(ws, owners);
    const stopReplies = new Map<
      string,
      { processId: string; resolve: () => void; reject: (error: Error) => void }
    >();
    const starting = new Map<string | number, string>();
    let process: ManagedProcess | undefined;
    let pending = "";
    let closed = false;
    let writes = Promise.resolve();
    const ready = provider
      .startProcess(
        workspace,
        {
          argv: ["codex", "exec-server", "--listen", "stdio"],
        },
        (chunk) => {
          pending += chunk;
          if (pending.length > 8 * 1024 * 1024) {
            ws.close(1009);
            return;
          }
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const frame = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (!frame.trim()) continue;
            try {
              const value = JSON.parse(frame);
              const stopReply =
                typeof value.id === "string"
                  ? stopReplies.get(value.id)
                  : undefined;
              if (stopReply) {
                stopReplies.delete(value.id);
                if (value.result?.running === false)
                  owners.delete(stopReply.processId);
                value.error
                  ? stopReply.reject(
                      new Error("Sandbox command termination failed"),
                    )
                  : stopReply.resolve();
                continue;
              }
              if (value.error && starting.has(value.id))
                owners.delete(starting.get(value.id)!);
              if ("id" in value) starting.delete(value.id);
              if (
                ["process/exited", "process/closed"].includes(value.method) &&
                typeof value.params?.processId === "string"
              )
                owners.delete(value.params.processId);
            } catch {
              diagnostic?.(
                "Execution service emitted an invalid protocol frame",
              );
              ws.close(1011);
              return;
            }
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
          }
        },
        (chunk) => diagnostic?.(chunk),
      )
      .then(async (remote) => {
        process = remote;
        processes.add(remote);
        if (closed) {
          await remote.stop();
          processes.delete(remote);
        }
        return remote;
      });
    void ready.catch(() => {
      diagnostic?.("Execution service failed to start");
      ws.close(1011);
    });
    terminators.set(ws, async (processId) => {
      await writes;
      const remote = await ready;
      const id = `nimbus-stop:${randomUUID()}`;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          stopReplies.delete(id);
          reject(new Error("Sandbox command stop acknowledgement timed out"));
        }, 10_000);
        stopReplies.set(id, {
          processId,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        void remote
          .write(
            JSON.stringify({
              id,
              method: "process/terminate",
              params: { processId },
            }) + "\n",
          )
          .catch((error) => {
            stopReplies.get(id)?.reject(error);
            stopReplies.delete(id);
          });
      });
      const deadline = Date.now() + 5000;
      while (owners.has(processId) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      if (owners.has(processId))
        throw new Error("Sandbox process did not confirm exit after stopping");
    });
    ws.on("message", (data, binary) => {
      if (binary) {
        ws.close(1003);
        return;
      }
      const frame = data.toString();
      try {
        const value = JSON.parse(frame);
        if (
          value.method === "process/start" &&
          typeof value.params?.processId === "string" &&
          currentRequest
        ) {
          if (stoppedRequests.has(currentRequest)) {
            ws.send(
              JSON.stringify({
                id: value.id,
                error: {
                  code: -32600,
                  message: "This request has been stopped",
                },
              }),
            );
            return;
          }
          owners.set(value.params.processId, currentRequest);
          starting.set(value.id, value.params.processId);
        }
      } catch {
        ws.close(1007);
        return;
      }
      writes = writes.then(async () => {
        const remote = await ready;
        if (!closed) await remote.write(`${frame}\n`);
      });
      void writes.catch(() => {
        diagnostic?.("Execution service input failed");
        ws.close(1011);
      });
    });
    ws.on("error", () => ws.close(1011));
    ws.on("close", () => {
      closed = true;
      terminators.delete(ws);
      requestProcesses.delete(ws);
      for (const reply of stopReplies.values())
        reply.reject(
          new Error("Sandbox execution connection closed during stop"),
        );
      stopReplies.clear();
      if (process) {
        processes.delete(process);
        void process.stop().catch(() => {});
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Execution bridge has no loopback address");
  return {
    url: `ws://127.0.0.1:${address.port}/exec`,
    beginRequest(messageId: string) {
      currentRequest = messageId;
    },
    async stopRequest(messageId: string) {
      stoppedRequests.add(messageId);
      const stops: Promise<void>[] = [];
      for (const [ws, owners] of requestProcesses)
        for (const [processId, owner] of owners)
          if (owner === messageId) {
            const terminate = terminators.get(ws);
            if (!terminate)
              throw new Error("Sandbox execution connection is unavailable");
            stops.push(terminate(processId));
          }
      await Promise.all(stops);
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await Promise.allSettled([...processes].map((remote) => remote.stop()));
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
