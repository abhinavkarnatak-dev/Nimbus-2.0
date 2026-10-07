// Shared by the dashboard and follow-up composer. CSS defines the one-line
// minimum and the cap; scrollHeight also accounts for wrapped text.
export function resizePrompt(input: HTMLTextAreaElement) {
  const css = getComputedStyle(input);
  const border =
    (Number.parseFloat(css.borderTopWidth) || 0) +
    (Number.parseFloat(css.borderBottomWidth) || 0);
  const minimum = Number.parseFloat(css.minHeight) || 32;
  const maximum = Number.parseFloat(css.maxHeight) || 192;
  input.style.height = "0px";
  const height = Math.max(
    minimum,
    Math.min(input.scrollHeight + border, maximum),
  );
  input.style.height = `${height}px`;
  input.style.overflowY =
    input.scrollHeight + border > maximum ? "auto" : "hidden";
}
