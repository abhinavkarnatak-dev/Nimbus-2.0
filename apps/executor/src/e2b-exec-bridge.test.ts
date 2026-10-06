import { once } from "node:events";
import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import { startE2BExecBridge } from "./e2b-exec-bridge.js";
import type { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";

const workspace = { id: "test-sandbox", root: "/workspace/repo" };
const token = "a".repeat(64);

describe("private remote execution transport", () => {
  it("terminates only processes belonging to the stopped request and waits for their exits", async () => {
    let stdout: (chunk: string) => void = () => {};
    const write = vi.fn(async (frame: string) => {
      const value = JSON.parse(frame);
      if (value.method === "process/terminate")
        stdout(
          JSON.stringify({ id: value.id, result: { running: true } }) +
            "\n" +
            JSON.stringify({
              method: "process/exited",
              params: { processId: value.params.processId },
            }) +
            "\n",
        );
    });
    const provider = {
      handle: vi.fn(),
      startProcess: vi.fn(async (_w, _r, callback) => {
        stdout = callback;
        return { id: "exec", write, stop: vi.fn(async () => {}) };
      }),
    } as unknown as E2BWorkspaceProvider;
    const bridge = await startE2BExecBridge(provider, workspace, token);
    const socket = new WebSocket(bridge.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    try {
      await once(socket, "open");
      bridge.beginRequest("old-request");
      socket.send(
        JSON.stringify({
          id: 1,
          method: "process/start",
          params: { processId: "old-process" },
        }),
      );
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      bridge.beginRequest("new-request");
      socket.send(
        JSON.stringify({
          id: 2,
          method: "process/start",
          params: { processId: "new-process" },
        }),
      );
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      await bridge.stopRequest("new-request");
      const kills = write.mock.calls
        .map(([frame]) => JSON.parse(frame))
        .filter((frame) => frame.method === "process/terminate");
      expect(kills.map((frame) => frame.params.processId)).toEqual([
        "new-process",
      ]);
      expect(kills[0].id).toMatch(/^nimbus-stop:/);
      await bridge.stopRequest("new-request");
      expect(write).toHaveBeenCalledTimes(3);
    } finally {
      socket.terminate();
      await bridge.close();
    }
  });
  it("rejects missing authentication before starting any remote process", async () => {
    const startProcess = vi.fn();
    const provider = {
      handle: vi.fn(),
      startProcess,
    } as unknown as E2BWorkspaceProvider;
    const bridge = await startE2BExecBridge(provider, workspace, token);
    try {
      const socket = new WebSocket(bridge.url);
      const [error] = await once(socket, "error");
      expect(error.message).toContain("401");
      expect(startProcess).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });
  it("streams RPC frames bidirectionally, preserving arguments without passing credentials", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    let stdout: (data: string) => void = () => {};
    const startProcess = vi.fn(async (_workspace, _request, callback) => {
      stdout = callback;
      return { id: "remote-process", write, stop };
    });
    const provider = {
      handle: vi.fn(),
      startProcess,
    } as unknown as E2BWorkspaceProvider;
    const bridge = await startE2BExecBridge(provider, workspace, token);
    try {
      const socket = new WebSocket(bridge.url, {
        headers: { authorization: `Bearer ${token}` },
      });
      await once(socket, "open");
      socket.send(JSON.stringify({ id: 1, method: "initialize", params: {} }));
      await vi.waitFor(() => expect(write).toHaveBeenCalled());
      expect(write).toHaveBeenCalledWith(
        '{"id":1,"method":"initialize","params":{}}\n',
      );
      expect(startProcess.mock.calls[0]?.[1]).toEqual({
        argv: ["codex", "exec-server", "--listen", "stdio"],
      });
      const message = once(socket, "message");
      stdout('{"id":1,"res');
      stdout('ult":{}}\n');
      const [frame] = await message;
      expect(frame.toString()).toBe('{"id":1,"result":{}}');
      socket.close();
      await once(socket, "close");
      await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    } finally {
      await bridge.close();
    }
  });
  it("refuses a disconnected sandbox and weak transport tokens", async () => {
    const provider = {
      handle: () => {
        throw new Error("not connected");
      },
    } as unknown as E2BWorkspaceProvider;
    await expect(
      startE2BExecBridge(provider, workspace, "short"),
    ).rejects.toThrow("strong");
    await expect(
      startE2BExecBridge(provider, workspace, token),
    ).rejects.toThrow("not connected");
  });
});
