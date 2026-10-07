import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { submitPromptOnEnter } from "./prompt-keyboard";

function fixture(
  overrides: Record<string, unknown> = {},
  inputOverrides: Record<string, unknown> = {},
) {
  const submit = vi.fn();
  const preventDefault = vi.fn();
  const form = {
    requestSubmit: submit,
    getAttribute: () => "false",
    querySelector: () => ({ disabled: false }),
  };
  const event = {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    preventDefault,
    currentTarget: {
      value: "Follow-up",
      matches: () => false,
      form,
      ...inputOverrides,
    },
    ...overrides,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  return { event, submit, preventDefault, form };
}
describe("prompt Enter shortcut", () => {
  it("uses the existing native form submission path for Enter", () => {
    const f = fixture();
    submitPromptOnEnter(f.event);
    expect(f.preventDefault).toHaveBeenCalledOnce();
    expect(f.submit).toHaveBeenCalledOnce();
  });
  it.each([
    { shiftKey: true },
    { key: "a" },
    { nativeEvent: { isComposing: true } },
    { nativeEvent: { keyCode: 229 } },
    { defaultPrevented: true },
  ])(
    "leaves newlines, IME input, and handled skill-menu keys alone: %j",
    (overrides) => {
      const f = fixture(overrides);
      submitPromptOnEnter(f.event);
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.preventDefault).not.toHaveBeenCalled();
    },
  );
  it.each([{ value: "  \n " }, { matches: () => true }, { form: null }])(
    "does not submit empty or disabled inputs: %j",
    (overrides) => {
      const f = fixture({}, overrides);
      submitPromptOnEnter(f.event);
      expect(f.submit).not.toHaveBeenCalled();
    },
  );
  it("does not resubmit on a held Enter key or during pending submission", () => {
    const held = fixture({ repeat: true });
    submitPromptOnEnter(held.event);
    expect(held.submit).not.toHaveBeenCalled();
    const pending = fixture();
    pending.form.getAttribute = () => "true";
    submitPromptOnEnter(pending.event);
    expect(pending.submit).not.toHaveBeenCalled();
    const disabled = fixture();
    disabled.form.querySelector = () => ({ disabled: true });
    submitPromptOnEnter(disabled.event);
    expect(disabled.submit).not.toHaveBeenCalled();
  });
});
