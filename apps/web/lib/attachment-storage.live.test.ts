import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { attachmentStorage } from "./attachment-storage";
describe.runIf(process.env.NIMBUS_ATTACHMENT_R2_LIVE === "true")(
  "real R2 attachment smoke test",
  () => {
    it("uploads, verifies, reads, checks browser CORS, and cleans its own objects", async () => {
      const storage = attachmentStorage();
      const prefix = `staging/nimbus-attachment-smoke/${randomUUID()}`;
      const keys = [
        prefix + "/original",
        prefix + "/text",
        prefix + "/final-original",
        prefix + "/final-text",
      ];
      try {
        const body = "Nimbus private attachment smoke test.";
        const upload = await storage.uploads(keys[0]!, Buffer.byteLength(body));
        const options = await fetch(upload, {
          method: "OPTIONS",
          headers: {
            Origin: "https://nimbus.abhinavkarnatak.com",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
          },
        });
        // Return only whether CORS is ready, never credentials or signed URLs.
        console.info(
          "R2 production browser-upload CORS:",
          options.headers.get("access-control-allow-origin") ===
            "https://nimbus.abhinavkarnatak.com"
            ? "ready"
            : "needs bucket configuration",
        );
        for (const key of keys.slice(0, 2)) {
          const response = await fetch(
            await storage.uploads(key, Buffer.byteLength(body)),
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body,
            },
          );
          expect(response.status).toBe(200);
        }
        await storage.finalize(
          keys[0]!,
          keys[1]!,
          Buffer.byteLength(body),
          keys[2]!,
          keys[3]!,
        );
        expect(await storage.text(keys[3]!)).toBe(body);
        const response = await fetch(
          await storage.download(keys[2]!, "smoke.txt"),
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(body);
        expect(response.headers.get("content-disposition")).toContain(
          "attachment",
        );
      } finally {
        for (const key of keys) await storage.remove(key);
        storage.close();
      }
    }, 90_000);
  },
);
