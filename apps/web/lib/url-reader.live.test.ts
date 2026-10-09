import { describe, expect, it } from "vitest";
import { prepareUrlReader } from "./url-reader";

// Opt-in only: no external service or database calls in the normal suite.
describe.skipIf(process.env.NIMBUS_URL_READER_LIVE !== "true")(
  "live public URL reads",
  () => {
    it("reads the static page through the real pinned-DNS transport", async () => {
      const result = await prepareUrlReader(
        new AbortController().signal,
      ).onUrlCall({ url: "https://example.com" });
      expect(result).toMatchObject({
        success: true,
        method: "http",
        title: "Example Domain",
        content: expect.stringContaining("documentation examples"),
      });
    }, 45_000);
    it("checks the real remote JSON/browser protocol without local Chromium", async () => {
      const result = await prepareUrlReader(new AbortController().signal, {
        page: async (url) => ({
          url,
          status: 200,
          type: "text/html",
          body: "<html><body>Loading...</body></html>",
        }),
      }).onUrlCall({ url: "https://www.iana.org/help/example-domains" });
      expect(result).toMatchObject({
        success: true,
        method: "remote_browser",
        content: expect.stringContaining("documentation"),
      });
    }, 45_000);
    it.each([
      "https://claude.ai/artifact/4dYaCNTTcsEXxMUx6G9Zz6",
      "https://x.com/kushbhuwalka/status/2107610618740314362",
    ])(
      "reports actual accessibility for %s",
      async (url) => {
        const result = (await prepareUrlReader(
          new AbortController().signal,
        ).onUrlCall({ url })) as {
          success: boolean;
          content?: string;
          code?: string;
          method?: string;
          message?: string;
        };
        // A site may restrict access; a bounded honest failure is not a read success.
        console.info(
          JSON.stringify({
            url,
            success: result.success,
            code: result.code,
            method: result.method,
            characters: result.content?.length,
            message: result.message,
          }),
        );
        if (result.success) {
          expect(result.content).toBeTruthy();
          expect(result.content).not.toMatch(
            /^Content is user-generated and unverified\.\s*$/,
          );
          if (url.includes("x.com/"))
            expect(result.content).toContain("puffle");
        } else {
          expect(result.code).toBeTruthy();
          expect(result.message).toBeTruthy();
        }
      },
      45_000,
    );
  },
);
