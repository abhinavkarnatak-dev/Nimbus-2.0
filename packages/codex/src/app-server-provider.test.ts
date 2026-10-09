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
  toolArgs: { title: "Organize files", body: "Summary" } as Record<
    string,
    unknown
  >,
  wrongThread: false,
  wrongEnvironment: false,
  omitResumedEnvironments: false,
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
                      environments:
                        request.method === "thread/resume" &&
                        transport.omitResumedEnvironments
                          ? undefined
                          : transport.wrongEnvironment
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
                if (
                  request.params.input?.some(
                    (entry: { type: string }) => entry.type === "image",
                  )
                ) {
                  child.stdout.write(
                    JSON.stringify({
                      method: "item/started",
                      params: {
                        threadId: "thread-test",
                        turnId: "turn-test",
                        item: {
                          id: "user-image",
                          type: "userMessage",
                          content: request.params.input,
                        },
                      },
                    }) + "\n",
                  );
                }
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
                        arguments: transport.toolArgs,
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
                if (
                  !(
                    transport.toolCall &&
                    ["nimbus_read_url", "nimbus_read_attachment"].includes(
                      transport.toolName,
                    )
                  )
                )
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
        if (
          String(request.id) === "tool-request" &&
          ["nimbus_read_url", "nimbus_read_attachment"].includes(
            transport.toolName,
          )
        )
          queueMicrotask(() =>
            child.stdout.write(
              JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId: "thread-test",
                  turn: { id: "turn-test", status: "completed" },
                },
              }) + "\n",
            ),
          );
        callback();
      },
    });
    return child;
  }),
}));

import {
  ChatThreadResumeError,
  CodexAppServerProvider,
} from "./app-server-provider.js";

afterEach(() => {
  vi.unstubAllEnvs();
  transport.requests = [];
  transport.exitCode = 0;
  transport.toolCall = false;
  transport.toolName = "nimbus_create_pull_request";
  transport.toolArgs = { title: "Organize files", body: "Summary" };
  transport.wrongThread = false;
  transport.wrongEnvironment = false;
  transport.omitResumedEnvironments = false;
});
const create = () =>
  new CodexAppServerProvider({
    accessToken: "test-token",
    requestTimeoutMs: 500,
  });

describe("Codex execution contract", () => {
  it("reads attachments through a scoped read-only callback without using publishing tools", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_attachment";
    transport.toolArgs = {
      id: "att_00000000000000000000000000000001",
      offset: 12000,
    };
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("test-model");
    const read = vi
      .fn()
      .mockResolvedValue({ success: true, content: "attachment text" });
    const publish = vi.fn();
    for await (const _event of provider.runTurn({
      threadId,
      prompt: "Read my file",
      onAttachmentCall: read,
    })) {
      /* consume */
    }
    expect(read).toHaveBeenCalledExactlyOnceWith(transport.toolArgs);
    expect(publish).not.toHaveBeenCalled();
    expect(
      transport.requests.find((request) => request.method === "thread/start")
        ?.params,
    ).toMatchObject({
      sandbox: "read-only",
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: "nimbus_read_attachment" }),
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
          {
            type: "inputText",
            text: expect.stringContaining("attachment text"),
          },
        ],
      },
    });
    await provider.stop();
  });
  it("denies a foreign-thread attachment read", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_attachment";
    transport.toolArgs = {};
    transport.wrongThread = true;
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("test-model");
    const read = vi.fn();
    for await (const _event of provider.runTurn({
      threadId,
      prompt: "Read files",
      onAttachmentCall: read,
    })) {
      /* consume */
    }
    expect(read).not.toHaveBeenCalled();
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("reads URLs in isolated general chat and streams honest progress without granting PR or shell tools", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_url";
    transport.toolArgs = { url: "https://example.com/article" };
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("test-model");
    const handler = vi
      .fn()
      .mockResolvedValue({ success: true, content: "Actual article content" });
    const publisher = vi.fn();
    const events = [];
    for await (const event of provider.runTurn({
      threadId,
      prompt: "Read the article",
      onUrlCall: handler,
    }))
      events.push(event);
    expect(handler).toHaveBeenCalledExactlyOnceWith(transport.toolArgs);
    expect(
      events
        .filter(
          (event) =>
            event.type === "activity" && event.method === "nimbus/urlRead",
        )
        .map(
          (event) => (event as { payload: { status: string } }).payload.status,
        ),
    ).toEqual(["running", "succeeded"]);
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({ result: { success: true } });
    expect(
      transport.requests.find((request) => request.method === "thread/start")
        ?.params.dynamicTools,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "nimbus_read_url" }),
      ]),
    );
    expect(
      transport.requests.some(
        (request) =>
          request.method === "environment/add" ||
          request.method === "command/exec",
      ),
    ).toBe(false);
    expect(publisher).not.toHaveBeenCalled();
    await provider.stop();
  });
  it("does not label an unavailable URL as a successful read or fail the chat turn", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_url";
    transport.toolArgs = { url: "https://example.com" };
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("test-model");
    const events = [];
    for await (const event of provider.runTurn({
      threadId,
      prompt: "Read URL",
      onUrlCall: async () => ({
        success: false,
        code: "site_blocked",
        message: "Site denied access",
      }),
    }))
      events.push(event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        method: "nimbus/urlRead",
        payload: expect.objectContaining({
          status: "failed",
          message: "Site denied access",
        }),
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "turn_completed",
      status: "completed",
    });
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("rejects foreign URL tool calls and never routes them through publishing", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_url";
    transport.wrongThread = true;
    const provider = create();
    await provider.start();
    const handler = vi.fn();
    const publisher = vi.fn();
    for await (const _ of provider.runTurn({
      threadId: "thread-test",
      prompt: "Read URL",
      onUrlCall: handler,
      onToolCall: publisher,
    })) {
      /* consume */
    }
    expect(handler).not.toHaveBeenCalled();
    expect(publisher).not.toHaveBeenCalled();
    expect(
      transport.requests.find(
        (request) => String(request.id) === "tool-request",
      ),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("passes images as native visual inputs without granting chat execution tools", async () => {
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("test-model");
    const events = [];
    for await (const event of provider.runTurn({
      threadId,
      prompt: "What is in this image?",
      imageUrls: ["https://private.example/image"],
    })) {
      events.push(event);
    }
    expect(JSON.stringify(events)).not.toContain(
      "https://private.example/image",
    );
    expect(JSON.stringify(events)).toContain("[private image attachment]");
    expect(
      transport.requests.find((request) => request.method === "turn/start")
        ?.params,
    ).toMatchObject({
      input: [
        { type: "text", text: "What is in this image?" },
        { type: "image", url: "https://private.example/image" },
      ],
      environments: [],
      sandboxPolicy: { type: "readOnly" },
      approvalPolicy: "never",
    });
    await provider.stop();
  });
  it("overrides the model between chat turns and sends a null effort for model-default reasoning", async () => {
    const provider = create();
    await provider.start();
    const threadId = await provider.startChatThread("original");
    for (const model of ["next", "original"]) {
      for await (const _ of provider.runTurn({
        threadId,
        prompt: "Continue",
        model,
      })) {
        /* consume */
      }
    }
    const turns = transport.requests.filter(
      (request) => request.method === "turn/start",
    );
    expect(turns.map((turn) => turn.params)).toEqual([
      expect.objectContaining({
        threadId,
        model: "next",
        effort: null,
        environments: [],
        sandboxPolicy: { type: "readOnly" },
      }),
      expect.objectContaining({
        threadId,
        model: "original",
        effort: null,
        environments: [],
        sandboxPolicy: { type: "readOnly" },
      }),
    ]);
    expect(
      transport.requests.filter((request) => request.method === "thread/start"),
    ).toHaveLength(1);
    await provider.stop();
  });
  it("classifies an unconfirmed resume after a process restart without enabling a turn", async () => {
    const provider = create();
    await provider.start();
    const id = await provider.startChatThread("test-model");
    await provider.stop();
    await provider.start();
    transport.omitResumedEnvironments = true;
    await expect(provider.resumeChatThread(id)).rejects.toBeInstanceOf(
      ChatThreadResumeError,
    );
    expect(
      transport.requests.some((request) => request.method === "turn/start"),
    ).toBe(false);
    // A newly-created chat still has to pass the original isolation checks.
    transport.wrongEnvironment = true;
    await expect(provider.startChatThread("test-model")).rejects.toThrow(
      "isolation was not confirmed",
    );
    await provider.stop();
  });
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
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: "nimbus_load_skill" }),
        expect.objectContaining({ name: "nimbus_read_repository" }),
        expect.objectContaining({ name: "nimbus_start_repository_work" }),
      ]),
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
  it("allows only read-only skill loading in general chat and preserves it on resume", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_load_skill";
    transport.toolArgs = { id: "frontend" };
    const provider = create();
    await provider.start();
    const id = await provider.startChatThread("test-model");
    await provider.resumeChatThread(id);
    const handler = vi.fn().mockResolvedValue({ summary: "Accessible UI" });
    for await (const _ of provider.runTurn({
      threadId: id,
      prompt: "Build UI",
      onSkillCall: handler,
    })) {
      /* consume */
    }
    expect(handler).toHaveBeenCalledExactlyOnceWith({ id: "frontend" });
    expect(
      transport.requests.find((r) => r.method === "thread/resume")?.params,
    ).not.toHaveProperty("dynamicTools");
    expect(
      transport.requests.find((r) => String(r.id) === "tool-request"),
    ).toMatchObject({ result: { success: true } });
    await provider.stop();
  });
  it("routes repository tools through a separate read-only/deferred callback without enabling execution", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_read_repository";
    transport.toolArgs = { repositoryId: "repo", path: "README.md" };
    const provider = create();
    await provider.start();
    const id = await provider.startChatThread("test-model");
    const handler = vi.fn().mockResolvedValue({ content: "Overview" });
    for await (const _ of provider.runTurn({
      threadId: id,
      prompt: "Explain repo",
      onRepositoryCall: handler,
    })) {
      /* consume */
    }
    expect(handler).toHaveBeenCalledExactlyOnceWith(
      "nimbus_read_repository",
      transport.toolArgs,
    );
    expect(
      transport.requests.find((r) => String(r.id) === "tool-request"),
    ).toMatchObject({ result: { success: true } });
    expect(
      transport.requests.some(
        (r) => r.method === "environment/add" || r.method === "command/exec",
      ),
    ).toBe(false);
    await provider.stop();
  });
  it("does not let the skill handler grant PR tools to general chat", async () => {
    transport.toolCall = true;
    transport.toolName = "nimbus_create_pull_request";
    const provider = create();
    await provider.start();
    const id = await provider.startChatThread("test-model");
    const handler = vi.fn();
    for await (const _ of provider.runTurn({
      threadId: id,
      prompt: "Build UI",
      onSkillCall: handler,
    })) {
      /* consume */
    }
    expect(handler).not.toHaveBeenCalled();
    expect(
      transport.requests.find((r) => String(r.id) === "tool-request"),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("rejects skill calls from a different thread", async () => {
    transport.toolCall = true;
    transport.wrongThread = true;
    transport.toolName = "nimbus_load_skill";
    const provider = create();
    await provider.start();
    const handler = vi.fn();
    for await (const _ of provider.runTurn({
      threadId: "thread-test",
      prompt: "Build UI",
      onSkillCall: handler,
    })) {
      /* consume */
    }
    expect(handler).not.toHaveBeenCalled();
    expect(
      transport.requests.find((r) => String(r.id) === "tool-request"),
    ).toMatchObject({ result: { success: false } });
    await provider.stop();
  });
  it("switches models on a resumed thread without changing its remote execution boundary", async () => {
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
      model: "next-model",
      reasoningEffort: "medium",
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
      model: "next-model",
      effort: "medium",
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
