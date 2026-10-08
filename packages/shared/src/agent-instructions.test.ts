import { describe, expect, it } from "vitest";
import {
  agentInstructionsSchema,
  withAgentInstructions,
} from "./agent-instructions.js";

describe("saved agent instructions", () => {
  it("prefers Mermaid only for flow/sequence diagrams while preserving explicit ASCII requests and folder trees", () => {
    const prompt = withAgentInstructions(
      "Show an ASCII flowchart",
      "Keep explanations brief",
    );
    expect(prompt).toContain("flowcharts and sequence diagrams");
    expect(prompt).toContain("explicitly requests ASCII");
    expect(prompt).toContain("folder/directory trees");
    expect(prompt).toContain("not Mermaid");
    expect(prompt).toContain("Current request:\nShow an ASCII flowchart");
    expect(prompt).toContain("do not authorize publishing");
  });
  it("normalizes plain text and permits clearing", () => {
    expect(
      agentInstructionsSchema.parse({
        content: "  Use hyphens.\r\nKeep it short.  ",
      }).content,
    ).toBe("Use hyphens.\nKeep it short.");
    expect(agentInstructionsSchema.parse({ content: " " }).content).toBe("");
  });
  it("rejects oversized and binary instructions", () => {
    expect(
      agentInstructionsSchema.safeParse({ content: "a".repeat(20_001) })
        .success,
    ).toBe(false);
    expect(
      agentInstructionsSchema.safeParse({ content: "bad\u0000text" }).success,
    ).toBe(false);
  });
  it("keeps request and preferences distinct without giving publishing authority", () => {
    const prompt = withAgentInstructions(
      "Read the README",
      "Use hyphens only.",
    );
    expect(prompt).toContain('"Use hyphens only."');
    expect(prompt).toContain("Current request:\nRead the README");
    expect(prompt).toContain("do not authorize publishing");
    expect(prompt).toContain("higher-priority instructions");
  });
  it("replaces stale thread preferences on follow-up and clearing", () => {
    expect(withAgentInstructions("Follow up", "New preferences")).toContain(
      "replaces earlier saved preferences",
    );
    expect(withAgentInstructions("Continue", "")).toContain(
      'snapshot replaces earlier saved preferences):\n""',
    );
  });
});
