import type { KeyboardEvent } from "react";

export function submitPromptOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.defaultPrevented ||
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  )
    return;
  event.preventDefault();
  const input = event.currentTarget;
  const form = input.form;
  if (
    event.repeat ||
    input.matches(":disabled") ||
    !input.value.trim() ||
    !form ||
    form.getAttribute("aria-busy") === "true"
  )
    return;
  const submitter = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitter?.disabled) return;
  // Preserve native form validation and the same onSubmit path as a click.
  form.requestSubmit();
}
