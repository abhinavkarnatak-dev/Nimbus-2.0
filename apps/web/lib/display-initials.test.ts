import { expect, it } from "vitest";
import { displayInitials } from "./display-initials";

it("uses the actual workspace name and handles possessives", () => {
  expect(displayInitials("Abhinav's workspace")).toBe("AW");
  expect(displayInitials("Abhinav’s workspace")).toBe("AW");
  expect(displayInitials("Nimbus Labs")).toBe("NL");
});
it("ignores extra spacing, supports Unicode, and has a safe fallback", () => {
  expect(displayInitials("  Ada   Lovelace ")).toBe("AL");
  expect(displayInitials("Élodie's workspace")).toBe("ÉW");
  expect(displayInitials("Nimbus")).toBe("N");
  expect(displayInitials(" ")).toBe("N");
});
