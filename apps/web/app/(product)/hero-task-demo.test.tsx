import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HERO_DEMO_DURATION,
  HeroTaskDemo,
  heroDemoFrame,
} from "./hero-task-demo";

vi.stubGlobal("React", React);
describe("hero task demo", () => {
  it("streams the user message before the agent reply", () => {
    expect(heroDemoFrame(0).prompt).toBe("");
    expect(heroDemoFrame(1300).prompt.length).toBeGreaterThan(0);
    expect(heroDemoFrame(1300).response).toBe("");
    expect(heroDemoFrame(3800).response.length).toBeGreaterThan(0);
    expect(heroDemoFrame(3800).inspecting).toBe(false);
  });
  it("reveals inspection, writing, verification and completion in order", () => {
    expect(heroDemoFrame(5500)).toMatchObject({
      inspecting: true,
      writing: false,
      verified: false,
    });
    expect(heroDemoFrame(7600)).toMatchObject({
      inspecting: true,
      writing: true,
      verified: false,
    });
    expect(heroDemoFrame(10200)).toMatchObject({
      verified: true,
      complete: false,
    });
    expect(heroDemoFrame(12000).complete).toBe(true);
  });
  it("fades before resetting and repeats without cumulative timer drift", () => {
    expect(heroDemoFrame(15500).opacity).toBe(0);
    expect(heroDemoFrame(HERO_DEMO_DURATION)).toEqual(heroDemoFrame(0));
    expect(heroDemoFrame(3 * HERO_DEMO_DURATION + 7600)).toEqual(
      heroDemoFrame(7600),
    );
  });
  it("retains both anchored badges and an accessible workflow description", () => {
    const html = renderToStaticMarkup(<HeroTaskDemo />);
    expect(html).toContain('role="img"');
    expect(html).toContain('data-orbit-badge="events"');
    expect(html).toContain('data-orbit-badge="outcome"');
    expect(html).toContain('data-visible="false"');
    expect(html).toContain("pass verification");
  });
});
