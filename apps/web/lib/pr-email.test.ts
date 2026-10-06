import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailConfiguration,
  EmailDeliveryError,
  PrEmail,
  renderPrEmail,
  sendPrEmail,
  type PrEmailData,
} from "./pr-email";
import { retryEmail } from "./pr-email-outbox";

const sample: PrEmailData = {
  event: "created",
  recipient: "test@example.com",
  name: "A <script>",
  title: "Fix <b>layout</b> & spacing",
  repository: "owner/repo",
  number: 12,
  taskId: "task_123",
  url: "https://github.com/owner/repo/pull/12",
};
const config = {
  apiKey: "re_test",
  from: "Nimbus <notify@example.com>",
  origin: "https://nimbus.example.com",
};
afterEach(() => vi.unstubAllEnvs());

describe("PR email templates and transport", () => {
  it.each(["created", "merged", "closed"] as const)(
    "renders %s with escaped content, text fallback and task/PR links",
    (event) => {
      const result = renderPrEmail({ ...sample, event }, config.origin);
      expect(result.html).toContain("&lt;script&gt;");
      expect(result.html).toContain(
        "Fix &lt;b&gt;layout&lt;/b&gt; &amp; spacing",
      );
      expect(result.html).not.toContain("<script>");
      expect(result.text).toContain(sample.url);
      expect(result.html).toContain(
        "https://nimbus.example.com/tasks/task_123",
      );
      expect(result.subject).toContain(event);
      if (event === "merged")
        expect(result.html).not.toContain("Closed without merging");
    },
  );
  it("rejects external, credential-bearing and mismatched PR URLs", () => {
    for (const url of [
      "https://evil.example/pull/12",
      "https://user@github.com/owner/repo/pull/12",
      "https://github.com/other/repo/pull/12",
      `${sample.url}?x=1`,
    ])
      expect(PrEmail.safeParse({ ...sample, url }).success).toBe(false);
  });
  it("missing configuration disables delivery", () => {
    expect(
      emailConfiguration({ RESEND_API_KEY: "", RESEND_FROM_EMAIL: "" }),
    ).toBeNull();
  });
  it("validates the sender and application origin", () => {
    expect(
      emailConfiguration({
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: config.from,
        AUTH_URL: config.origin,
      }),
    ).toEqual(config);
    expect(() =>
      emailConfiguration({
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: "bad\r\n@example.com",
      }),
    ).toThrow();
    expect(() =>
      emailConfiguration({
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: config.from,
        AUTH_URL: "http://evil.example",
      }),
    ).toThrow();
  });
  it("uses fixed Resend endpoint, stable key, timeout and no redirects", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "mail_1" }));
    expect(await sendPrEmail(sample, "pr-created-1", config, transport)).toBe(
      "mail_1",
    );
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.redirect).toBe("error");
    expect(options.headers["idempotency-key"]).toBe("pr-created-1");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body).to).toEqual([sample.recipient]);
  });
  it.each([
    [429, true],
    [500, true],
    [401, false],
    [422, false],
  ])(
    "classifies HTTP %i without leaking provider bodies",
    async (status, retryable) => {
      const transport = vi
        .fn()
        .mockResolvedValue(new Response("secret-provider-message", { status }));
      await expect(
        sendPrEmail(sample, "key", config, transport),
      ).rejects.toMatchObject({ retryable, message: `Resend HTTP ${status}` });
    },
  );
  it("treats network failures and unconfirmed responses as retryable", async () => {
    await expect(
      sendPrEmail(
        sample,
        "key",
        config,
        vi.fn().mockRejectedValue(new Error("sensitive")),
      ),
    ).rejects.toMatchObject({
      retryable: true,
      message: "Resend request timed out or failed",
    });
    await expect(
      sendPrEmail(
        sample,
        "key",
        config,
        vi.fn().mockResolvedValue(Response.json({})),
      ),
    ).rejects.toMatchObject({ retryable: true });
  });
  it("stops retries before idempotency expires and after eight attempts", () => {
    const now = Date.now();
    const transient = new EmailDeliveryError(true, "temporary");
    expect(retryEmail(1, new Date(now).toISOString(), transient, now)).toBe(
      true,
    );
    expect(retryEmail(8, new Date(now).toISOString(), transient, now)).toBe(
      false,
    );
    expect(
      retryEmail(
        1,
        new Date(now - 23 * 60 * 60_000).toISOString(),
        transient,
        now,
      ),
    ).toBe(false);
    expect(
      retryEmail(
        1,
        new Date(now).toISOString(),
        new EmailDeliveryError(false, "permanent"),
        now,
      ),
    ).toBe(false);
  });
});
