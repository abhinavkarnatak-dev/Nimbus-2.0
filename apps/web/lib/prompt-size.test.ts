import { afterEach, describe, expect, it, vi } from "vitest";
import { resizePrompt } from "./prompt-size";
afterEach(() => vi.unstubAllGlobals());
describe("bounded auto-growing prompts", () => {
  it("shrinks back to one line when a long message is cleared", () => {
    vi.stubGlobal("getComputedStyle", () => ({
      minHeight: "36px",
      maxHeight: "192px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
    }));
    const input = { scrollHeight: 300, style: {} } as HTMLTextAreaElement;
    resizePrompt(input);
    Object.defineProperty(input, "scrollHeight", { value: 24 });
    resizePrompt(input);
    expect(input.style.height).toBe("36px");
    expect(input.style.overflowY).toBe("hidden");
  });
  it.each([
    [24, "36px", "hidden"],
    [100, "100px", "hidden"],
    [300, "192px", "auto"],
  ])(
    "sizes content height %s and only scrolls after the cap",
    (scrollHeight, height, overflow) => {
      vi.stubGlobal("getComputedStyle", () => ({
        minHeight: "36px",
        maxHeight: "192px",
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
      }));
      const input = { scrollHeight, style: {} } as HTMLTextAreaElement;
      resizePrompt(input);
      expect(input.style.height).toBe(height);
      expect(input.style.overflowY).toBe(overflow);
    },
  );
});
