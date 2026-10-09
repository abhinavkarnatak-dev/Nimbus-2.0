import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  lookup: vi.fn(),
  requests: [] as Array<{ url: URL; options: Record<string, unknown> }>,
  pages: [] as Array<{
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  }>,
}));
vi.mock("node:dns/promises", () => ({ lookup: transport.lookup }));
vi.mock("node:https", () => ({
  request: (
    url: URL,
    options: Record<string, unknown>,
    callback: (response: unknown) => void,
  ) => {
    transport.requests.push({ url, options });
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () =>
      queueMicrotask(() => {
        const page = transport.pages.shift() ?? {};
        const response = Object.assign(new EventEmitter(), {
          statusCode: page.status ?? 200,
          headers: page.headers ?? { "content-type": "text/html" },
          destroy(error?: Error) {
            if (error) response.emit("error", error);
          },
        });
        callback(response);
        if ((page.status ?? 200) < 300 || (page.status ?? 200) >= 400) {
          response.emit("data", Buffer.from(page.body ?? ""));
          response.emit("end");
        }
      });
    return request;
  },
}));
import {
  extractPage,
  prepareUrlReader,
  publicAddress,
  publicUrl,
  safePage,
  unusableContent,
  type PageResponse,
} from "./url-reader";
const content =
  "This is the actual public article text explaining the design and its implementation, not a search snippet.";
const page = vi.fn();
const render = vi.fn();
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  transport.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  transport.requests = [];
  transport.pages = [];
  page.mockResolvedValue({
    url: "https://example.com/article",
    status: 200,
    type: "text/html",
    body: `<html><head><title>Article</title></head><body><nav>Ignore navigation</nav><main><p>${content}</p><script>Ignore script</script></main></body></html>`,
  });
  render.mockResolvedValue({
    url: "https://example.com/article",
    status: 200,
    type: "text/markdown",
    body: JSON.stringify({ title: "Rendered article", content }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("public URL safety", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("rejects non-public address %s", (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it.each([
    "file:///etc/passwd",
    "http://localhost",
    "http://2130706433",
    "https://127.1",
    "http://[::ffff:7f00:1]",
    "http://user:pass@example.com",
    "https://example.com:444",
    "https://metadata.internal",
  ])("rejects unsafe URL %s", (url) => expect(() => publicUrl(url)).toThrow());
  it("blocks DNS pointing at a private network, including mixed public/private answers", async () => {
    transport.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect(
      await prepareUrlReader(signal(), { page, render }).onUrlCall({
        url: "https://example.com",
      }),
    ).toMatchObject({ success: false, code: "unsafe_url" });
    expect(page).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it("pins validated DNS while preserving the HTTPS target and follows safe redirects", async () => {
    transport.pages = [
      { status: 302, headers: { location: "/article" } },
      { body: `<html><body>${content}</body></html>` },
    ];
    expect(await safePage("https://example.com", signal())).toMatchObject({
      status: 200,
      url: "https://example.com/article",
    });
    const callback = vi.fn();
    (
      transport.requests[0]!.options.lookup as (
        host: string,
        options: object,
        callback: (error: null, address: string, family: number) => void,
      ) => void
    )("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(transport.requests[0]!.url.hostname).toBe("example.com");
    expect(transport.requests[0]!.options.headers).not.toHaveProperty(
      "Authorization",
    );
  });
  it("rejects redirects into private networks before opening a second socket", async () => {
    transport.pages = [
      {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      },
    ];
    await expect(safePage("https://example.com", signal())).rejects.toThrow(
      "public",
    );
    expect(transport.requests).toHaveLength(1);
  });
  it("rejects DNS rebinding on a redirect", async () => {
    transport.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    transport.pages = [{ status: 302, headers: { location: "/next" } }];
    await expect(safePage("https://example.com", signal())).rejects.toThrow(
      "private",
    );
    expect(transport.requests).toHaveLength(1);
  });
  it("stops downloads at the byte limit", async () => {
    transport.pages = [{ body: "x".repeat(1_000_001) }];
    await expect(safePage("https://example.com", signal())).rejects.toThrow(
      "1 MB",
    );
  });
});
describe("bounded URL reader", () => {
  it("uses the fixed remote browser endpoint and sends the reader key only to that service", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        code: 200,
        data: {
          url: "https://example.com/article",
          title: "Article",
          content,
          httpStatus: 200,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    page.mockResolvedValue({
      url: "https://example.com/article",
      status: 200,
      type: "text/html",
      body: "<html><body>Loading...</body></html>",
    });
    expect(
      await prepareUrlReader(signal(), { page, key: "reader-key" }).onUrlCall({
        url: "https://example.com/article",
      }),
    ).toMatchObject({ success: true, method: "remote_browser", content });
    expect(fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com/article",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer reader-key",
          "X-With-Iframe": "true",
          "X-No-Cache": "true",
        }),
      }),
    );
    expect(page.mock.calls[0]).toHaveLength(2);
  });
  it("preserves SPA hash routing using a POST without forwarding cookies or credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        code: 200,
        data: {
          url: "https://example.com/#/article",
          title: "Article",
          content,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("JINA_API_KEY", "");
    expect(
      await prepareUrlReader(signal(), { page }).onUrlCall({
        url: "https://example.com/#/article",
      }),
    ).toMatchObject({ success: true, method: "remote_browser" });
    expect(fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/#/article" }),
      }),
    );
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty("Cookie");
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
  });
  it.each([401, 403, 429])(
    "returns a structured reader refusal for HTTP %s without failing the surrounding turn",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("Reader refused", { status })),
      );
      page.mockRejectedValue(new Error("Direct site refused"));
      const result = await prepareUrlReader(signal(), {
        page,
        key: "",
      }).onUrlCall({ url: "https://example.com" });
      expect(result).toMatchObject({
        success: false,
        code:
          status === 401
            ? "reader_configuration"
            : status === 429
              ? "rate_limited"
              : "site_blocked",
      });
    },
  );
  it("rejects remote private source URLs and HTTP error pages even with a successful reader envelope", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          data: { url: "http://127.0.0.1", title: "Article", content },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          data: {
            url: "https://example.com",
            title: "Error",
            content,
            httpStatus: 404,
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    page.mockRejectedValue(new Error("Direct failed"));
    const tools = prepareUrlReader(signal(), { page });
    expect(
      await tools.onUrlCall({ url: "https://example.com/1" }),
    ).toMatchObject({ success: false, code: "unsafe_url" });
    expect(
      await tools.onUrlCall({ url: "https://example.com/2" }),
    ).toMatchObject({ success: false, code: "content_unavailable" });
  });
  it("cancels oversized remote bodies before parsing them", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1_000_001));
            },
            cancel,
          }),
        ),
      ),
    );
    page.mockRejectedValue(new Error("Direct failed"));
    expect(
      await prepareUrlReader(signal(), { page }).onUrlCall({
        url: "https://example.com",
      }),
    ).toMatchObject({ success: false, code: "too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds in-flight reads and releases capacity after completion", async () => {
    const releases: Array<(value: PageResponse) => void> = [];
    page.mockImplementation(
      () => new Promise<PageResponse>((resolve) => releases.push(resolve)),
    );
    const first = prepareUrlReader(signal(), { page }).onUrlCall({
      url: "https://example.com/1",
    });
    const second = prepareUrlReader(signal(), { page }).onUrlCall({
      url: "https://example.com/2",
    });
    expect(
      await prepareUrlReader(signal(), { page }).onUrlCall({
        url: "https://example.com/3",
      }),
    ).toMatchObject({ success: false, code: "reader_busy" });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const value = {
      url: "https://example.com",
      status: 200,
      type: "text/plain",
      body: content,
    };
    releases.forEach((resolve) => resolve(value));
    await Promise.all([first, second]);
    page.mockResolvedValue(value);
    expect(
      await prepareUrlReader(signal(), { page }).onUrlCall({
        url: "https://example.com/4",
      }),
    ).toMatchObject({ success: true });
  });
  it("extracts actual article text, strips scripts/navigation, and reuses reads only within the request", async () => {
    const tools = prepareUrlReader(signal(), { page, render });
    const result = await tools.onUrlCall({
      url: "https://example.com/article",
    });
    expect(result).toMatchObject({
      success: true,
      title: "Article",
      content,
      method: "http",
      truncated: false,
    });
    expect(render).not.toHaveBeenCalled();
    expect(
      await tools.onUrlCall({ url: "https://example.com/article" }),
    ).toEqual(result);
    expect(page).toHaveBeenCalledTimes(1);
    await prepareUrlReader(signal(), { page, render }).onUrlCall({
      url: "https://example.com/article",
    });
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("renders JS-only and embedded pages without starting a sandbox", async () => {
    page.mockResolvedValue({
      url: "https://example.com/article",
      status: 200,
      type: "text/html",
      body: '<html><head><title>Claude Artifact</title></head><body><main><div data-frame-uchost="frame.example.com">Content is user-generated and unverified.</div></main></body></html>',
    });
    expect(
      await prepareUrlReader(signal(), {
        page,
        render,
        key: "reader-only-key",
      }).onUrlCall({ url: "https://example.com/article" }),
    ).toMatchObject({ success: true, method: "remote_browser", content });
    expect(render).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.any(AbortSignal),
      "reader-only-key",
    );
  });
  it("never reports the Claude outer shell or an X challenge as successful content", async () => {
    page.mockRejectedValue(new Error("blocked"));
    render.mockResolvedValue({
      url: "https://example.com",
      status: 200,
      type: "text/markdown",
      body: JSON.stringify({
        title: "Claude Artifact",
        content:
          "Content is user-generated and unverified.\n[Sign in](https://claude.ai/login)\nContent is user-generated and unverified.",
      }),
    });
    expect(
      await prepareUrlReader(signal(), { page, render }).onUrlCall({
        url: "https://example.com",
      }),
    ).toMatchObject({ success: false, code: "content_unavailable" });
    expect(
      unusableContent("Please verify you are human before continuing", "X"),
    ).toBe(true);
  });
  it("reports embedded text as partial if the rendered fallback fails", async () => {
    page.mockResolvedValue({
      url: "https://example.com",
      status: 200,
      type: "text/html",
      body: `<html><body><main>${content}<iframe src="https://example.com/embed"></iframe></main></body></html>`,
    });
    render.mockRejectedValue(new Error("reader failed"));
    expect(
      await prepareUrlReader(signal(), { page, render }).onUrlCall({
        url: "https://example.com",
      }),
    ).toMatchObject({ success: true, partial: true, method: "http" });
  });
  it("does not retry unsafe or oversized direct reads through a remote service", async () => {
    transport.pages = [
      { status: 302, headers: { location: "http://127.0.0.1" } },
    ];
    expect(
      await prepareUrlReader(signal(), { render }).onUrlCall({
        url: "https://example.com",
      }),
    ).toMatchObject({ success: false, code: "unsafe_url" });
    expect(render).not.toHaveBeenCalled();
  });
  it("truncates returned text with an explicit flag and enforces the turn budget", async () => {
    page.mockResolvedValue({
      url: "https://example.com",
      status: 200,
      type: "text/plain",
      body: "a".repeat(30_000),
    });
    const tools = prepareUrlReader(signal(), { page, render });
    const result = (await tools.onUrlCall({
      url: "https://example.com/1",
    })) as { content: string; truncated: boolean };
    expect(result.content).toHaveLength(24_000);
    expect(result.truncated).toBe(true);
    for (let i = 2; i <= 4; i++)
      await tools.onUrlCall({ url: `https://example.com/${i}` });
    expect(
      await tools.onUrlCall({ url: "https://example.com/5" }),
    ).toMatchObject({ success: false, code: "read_limit" });
  });
  it("rejects extra parameters and propagates user cancellation", async () => {
    const controller = new AbortController();
    const tools = prepareUrlReader(controller.signal, { page, render });
    expect(
      await tools.onUrlCall({ url: "https://example.com", cookies: "secret" }),
    ).toMatchObject({ code: "invalid_arguments" });
    controller.abort();
    await expect(
      tools.onUrlCall({ url: "https://example.com" }),
    ).rejects.toThrow();
    expect(page).not.toHaveBeenCalled();
  });
  it("preserves paragraph separation without running page JavaScript", () => {
    expect(
      extractPage({
        url: "https://example.com",
        status: 200,
        type: "text/html",
        body: "<html><body><main><p>First</p><p>Second</p><script>process.exit()</script></main></body></html>",
      }).content,
    ).toBe("First\nSecond");
  });
});
