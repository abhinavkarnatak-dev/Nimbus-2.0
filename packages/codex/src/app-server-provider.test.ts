import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  requests: [] as Array<{
    id: number;
    method: string;
    params: Record<string, unknown>;
  }>,
  exitCode: 0,
  toolCall: false,
  toolName: "nimbus_create_pull_request",
  wrongThread: false,
  wrongEnvironment: false,
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      stdin: undefined as unknown as Writable,
      kill() {
        this.killed = true;
        queueMicrotask(() => child.emit("exit", 0));
        return true;
      },
    });
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk));
        transport.requests.push(request);
        if (request.id !== undefined && request.method)
          queueMicrotask(() => {
            const result =
              request.method === "thread/start" ||
              request.method === "thread/resume"
                ? {
                    thread: {
                      id: "thread-test",
                      environments: transport.wrongEnvironment
                        ? [{ environmentId: "unexpected-host" }]
                        : (request.params.environments ?? []),
                    },
                  }
                : request.method === "environment/info"
                  ? {
                      cwd: "file:///workspace/repo",
                      shell: { path: "/bin/bash" },
                    }
                  : request.method === "turn/start"
                    ? { turn: { id: "turn-test" } }
                    : request.method === "command/exec"
                      ? {
                          exitCode: transport.exitCode,
                          stdout: "README.md",
                          stderr: "",
                        }
                      : {};
            child.stdout.write(
              JSON.stringify({ id: request.id, result }) + "\n",
            );
            if (request.method === "turn/start")
              setImmediate(() => {
                if (transport.toolCall)
                  child.stdout.write(
                    JSON.stringify({
                      id: "tool-request",
                      method: "item/tool/call",
                      params: {
                        threadId: transport.wrongThread
                          ? "other-thread"
                          : "thread-test",
                        turnId: "turn-test",
                        callId: "call-test",
                        tool: transport.toolName,
                        arguments: { title: "Organize files", body: "Summary" },
                      },
                    }) + "\n",
                  );
                child.stdout.write(
                  JSON.stringify({
                    method: "item/agentMessage/delta",
                    params: {
                      threadId: "thread-test",
                      itemId: "message-test",
                      delta: "Hello",
                    },
                  }) + "\n",
                );
                child.stdout.write(
                  JSON.stringify({
                    method: "turn/completed",
                    params: {
                      threadId: "thread-test",
                      turn: { id: "turn-test", status: "completed" },
                    },
                  }) + "\n",
                );
              });
          });
        callback();
      },
    });
    return child;
  }),
}));

import { CodexAppServerProvider } from "./app-server-provider.js";

afterEach(() => {
  vi.unstubAllEnvs();
  transport.requests = [];
  transport.exitCode = 0;
  transport.toolCall = false;
  transport.toolName = "nimbus_create_pull_request";
  transport.wrongThread = false;
  transport.wrongEnvironment = false;
});
const create = () =>
  new CodexAppServerProvider({
    accessToken: "test-token",
    requestTimeoutMs: 500,
  });

describe("Codex execution contract", () => {
  it("fails closed for server device login unless explicitly enabled and persistent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NIMBUS_DEVICE_AUTH_ENABLED", "false");
    expect(
      () =>
        new CodexAppServerProvider({
          localDeviceAuth: { home: "/private", persistent: true },
        }),
    ).toThrow("disabled");
    vi.stubEnv("NIMBUS_DEVICE_AUTH_ENABLED", "true");
    expect(
      () =>
        new CodexAppServerProvider({ localDeviceAuth: { home: "/private" } }),
    ).toThrow("persistent");
  });
  it("uses the user's private file store without exposing server secrets to Codex", async () => {
    vi.stubEnv("AUTH_SECRET", "private-session-secret");
    vi.stubEnv("NIMBUS_EXECUTOR_SECRET", "private-internal-secret");
    const provider = new CodexAppServerProvider({
      localDeviceAuth: { home: "/private/user-a", persistent: true },
      requestTimeoutMs: 500,
    });
    await provider.start();
    const call = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(call[1]).toContain('cli_auth_credentials_store="file"');
    const options = call[2] as { env: Record<string, string> };
    expect(options.env.CODEX_HOME).toBe("/private/user-a");
    expect(options.env.AUTH_SECRET).toBeUndefined();
    expect(options.env.NIMBUS_EXECUTOR_SECRET).toBeUndefined();
    await provider.logoutDevice();
    expect(transport.requests.some((r) => r.method === "account/logout")).toBe(
      true,
    );
    await provider.stop();
  });
  it("refuses general chat when the runtime fails to confirm disabled environments", async () => {
    const provider = create();
    await provider.start();
    transport.wrongEnvironment = true;
    await expect(provider.startChatThread("test-model")).rejects.toThrow(
      "isolation was not confirmed",
    );
    await expect(provider.resumeChatThread("thread-test")).rejects.toThrow(
      "isolation was not confirmed",
    );
    expect(transport.requests.some((r) => r.method === "turn/start")).toBe(
      false,
    );
    await provider.stop();
  });
  it("starts and resumes chat without environment access, execution tools, or PR tools", async () => {
    const provider = create();
    await provider.start();
    const id = await provider.startChatThread("test-model");
    await provider.resumeChatThread(id);
    for await (const _ of provider.runTurn({ threadId: id, prompt: "Hello" })) {
      /* consume */
    }
    for (const method of ["thread/start", "thread/resume", "turn/start"]) {
      expect(
        transport.requests.find((r) => r.method === method)?.params,
      ).toMatchObject({ environments: [], runtimeWorkspaceRoots: [] });
    }
    const start = transport.requests.find(
      (r) => r.method === "thread/start",
    )!.params;
    expect(start).toMatchObject({
      dynamicTools: [],
      sandbox: "read-only",
      config: {
        "features.shell_tool": false,
        "features.unified_exec": false,
        "features.hooks": false,
      },
    });
    expect(
      transport.requests.some(
        (r) => r.method === "environment/add" || r.method === "command/exec",
      ),
    ).toBe(false);
    await expect(async () => {
      for await (const _ of provider.runTurn({
        threadId: id,
        prompt: "Execute",
        workspacePath: "C:/secret",
      })) {
        /* consume */
      }
    }).rejects.toThrow("General chat cannot acquire");
    await expect(async () => {
      for await (const _ of provider.runTurn({
        threadId: id,
        prompt: "Publish",
        onToolCall: async () => "not allowed",
      })) {
        /* consume */
      }
    }).rejects.toThrow("General chat cannot acquire");
    await provider.stop();
  });
  it("pins remote execution on new and resumed threads, without a host command probe", async () => {
    const provider = create();
    await provider.start();
    const environment = {
      environmentId: "nimbus_task_test",
      execServerUrl: "ws://127.0.0.1:3021/exec",
      authBearerToken: "a".repeat(64),
    };
    await provider.registerRemoteEnvironment(environment);
    await provider.registerRemoteEnvironment(environment);
    await provider.startThread({
      workspacePath: "/workspace/repo",
      model: "test-model",
      environmentId: environment.environmentId,
    });
    await provider.resumeThread("thread-test", environment.environmentId);
    for await (const _ of provider.runTurn({
      threadId: "thread-test",
      prompt: "Inspect",
      environmentId: environment.environmentId,
    })) {
      /* consume */
    }
    expect(
      transport.requests.filter((r) => r.method === "environment/add"),
    ).toHaveLength(1);
    expect(
      transport.requests.find((r) => r.method === "turn/start")?.params,
    ).toMatchObject({
      environments: [
        { environmentId: environment.environmentId, cwd: "/workspace/repo" },
      ],
      sandboxPolicy: { type: "externalSandbox" },
    });
    expect(transport.requests.some((r) => r.method === "command/exec")).toBe(
      false,
    );
    await expect(async () => {
      for await (const _ of provider.runTurn({
        threadId: "thread-test",
        prompt: "Inspect",
      })) {
        /* consume */
      }
    }).rejects.toThrow("host fallback");
    await provider.stop();
  });
  it("dispatches the feedback reader through the same scoped RPC handler", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_pull_request";
    const provider = create();
    await provider.start();
    const handler = vi
      .fn()
      .mockResolvedValue({ number: 16, comments: [{ body: "Fix greeting" }] });
    for await (const _event of provider.runTurn({
      threadId: "thread-test",
      prompt: "Read PR comments",
      onToolCall: handler,
    })) {
      /* consume */
    }
    expect(handler).toHaveBeenCalledWith(
      "nimbus_read_pull_request",
      expect.any(Object),
    );
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({
      result: {
        success: true,
        contentItems: [
          { type: "inputText", text: expect.stringContaining("Fix greeting") },
        ],
      },
    });
    await provider.stop();
  });
  it("registers publishing as a dynamic tool and returns its result through RPC", async () => {
    transport.toolCall = true;
    const provider = create();
    await provider.start();
    await provider.startThread({
      workspacePath: "C:/isolated/task",
      model: "test",
    });
    const handler = vi
      .fn()
      .mockResolvedValue({ url: "https://github.com/test/repo/pull/14" });
    for await (const _event of provider.runTurn({
      threadId: "thread-test",
      prompt: "Create PR",
      onToolCall: handler,
    })) {
      /* consume */
    }
    expect(handler).toHaveBeenCalledExactlyOnceWith(
      "nimbus_create_pull_request",
      { title: "Organize files", body: "Summary" },
    );
    expect(
      transport.requests.find((request) => request.method === "initialize")
        ?.params,
    ).toMatchObject({ capabilities: { experimentalApi: true } });
    expect(
      transport.requests.find((request) => request.method === "thread/start")
        ?.params,
    ).toMatchObject({
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: "nimbus_create_pull_request" }),
        expect.objectContaining({ name: "nimbus_read_pull_request" }),
      ]),
    });
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({
      result: {
        success: true,
        contentItems: [
          { type: "inputText", text: expect.stringContaining("/pull/14") },
        ],
      },
    });
    await provider.stop();
  });
  it("denies a tool call from a different thread without running the handler", async () => {
    transport.toolCall = true;
    transport.wrongThread = true;
    const provider = create();
    await provider.start();
    const handler = vi.fn();
    for await (const _event of provider.runTurn({
      threadId: "thread-test",
      prompt: "Create PR",
      onToolCall: handler,
    })) {
      /* consume */
    }
    expect(handler).not.toHaveBeenCalled();
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("sets repository permissions explicitly on every turn, including resumed threads", async () => {
    const provider = create();
    await provider.start();
    await provider.resumeThread("thread-test");
    const events = [];
    for await (const event of provider.runTurn({
      threadId: "thread-test",
      workspacePath: "C:/isolated/task",
      prompt: "Describe the repository",
      reasoningEffort: "medium",
    }))
      events.push(event);
    expect(
      transport.requests.find((request) => request.method === "turn/start")
        ?.params,
    ).toMatchObject({
      cwd: "C:/isolated/task",
      approvalPolicy: "never",
      effort: "medium",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["C:/isolated/task"],
        networkAccess: false,
      },
    });
    expect(events).toEqual([
      { type: "agent_message_delta", itemId: "message-test", text: "Hello" },
      { type: "turn_completed", turnId: "turn-test", status: "completed" },
    ]);
    await provider.stop();
  });
  it("checks repository access without starting a model turn", async () => {
    const provider = create();
    await provider.start();
    await provider.verifyWorkspace("C:/isolated/task");
    expect(
      transport.requests.find((request) => request.method === "command/exec")
        ?.params,
    ).toMatchObject({
      cwd: "C:/isolated/task",
      timeoutMs: 10000,
      sandboxPolicy: { type: "workspaceWrite" },
    });
    expect(
      transport.requests.some((request) => request.method === "turn/start"),
    ).toBe(false);
    await provider.stop();
  });
  it("rejects unsuccessful sandbox preflight rather than consuming a model turn", async () => {
    transport.exitCode = 1;
    const provider = create();
    await provider.start();
    await expect(provider.verifyWorkspace("C:/isolated/task")).rejects.toThrow(
      "No model turn was started",
    );
    expect(
      transport.requests.some((request) => request.method === "turn/start"),
    ).toBe(false);
    await provider.stop();
  });
});
