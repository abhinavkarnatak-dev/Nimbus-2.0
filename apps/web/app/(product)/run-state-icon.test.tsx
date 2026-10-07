import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunStateIcon } from "./run-state-icon";

describe("dashboard task state icons", () => {
  it.each(["completed", "pr_open", "idle"])(
    "shows a green tick only for idle outcomes (%s)",
    (status) => {
      const html = renderToStaticMarkup(
        createElement(RunStateIcon, { status }),
      );
      expect(html).toContain("run-icon success");
      expect(html).toContain("lucide-circle-check");
    },
  );
  it.each([
    ["failed", "failed", "lucide-circle-x"],
    ["cancelling", "cancelling", "lucide-loader-circle"],
    ["cancelled", "neutral", "lucide-circle-slash"],
    ["queued", "neutral", "lucide-clock"],
    ["running", "active", "lucide-loader-circle"],
  ])("uses a distinct icon for %s", (status, tone, icon) => {
    const html = renderToStaticMarkup(createElement(RunStateIcon, { status }));
    expect(html).toContain(`run-icon ${tone}`);
    expect(html).toContain(icon);
    expect(html).not.toContain("lucide-circle-check");
  });
  it("shows archived sessions without implying success", () => {
    const html = renderToStaticMarkup(
      createElement(RunStateIcon, {
        status: "completed",
        archivedAt: "2026-10-07",
      }),
    );
    expect(html).toContain("run-icon neutral");
    expect(html).toContain("lucide-archive");
  });
});
