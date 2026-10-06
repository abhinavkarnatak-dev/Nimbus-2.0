import { describe, expect, it } from "vitest";
import {
  sessionTitleFromResponse,
  sessionTitlePrompt,
  SessionTitleTracker,
  presentSessionTurn,
  sessionTitleFromMetadata,
} from "./session-title.js";

describe("session title metadata", () => {
  it("does not ask for another session title once the title is generated", () => {
    expect(
      sessionTitlePrompt("Now show the code", "Repository Overview", true),
    ).toContain("Do not add an opening heading");
    expect(
      sessionTitlePrompt("Now show the code", "Repository Overview", true),
    ).not.toContain("Session metadata instruction");
    const tracker = new SessionTitleTracker(false);
    tracker.observe({
      type: "agent_message_delta",
      text: "## A Different Follow-up Topic",
    });
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBeNull();
  });
  it("publishes only once even if duplicate completion events arrive", () => {
    const tracker = new SessionTitleTracker();
    tracker.observe({
      type: "agent_message_delta",
      text: 'Details\n<nimbus_session_title>"Repository Overview"</nimbus_session_title>',
    });
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBe("Repository Overview");
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBeNull();
  });
  it("requests a summary without changing the original objective or granting actions", () => {
    const prompt = sessionTitlePrompt(
      "Read HelloName.cpp without editing.",
      "Repository overview",
    );
    expect(prompt).toMatch(/^Read HelloName.cpp without editing\./);
    expect(prompt).toContain("session's actual topic and work");
    expect(prompt).not.toContain("Start your final answer");
    expect(prompt).toContain(
      "does not authorize additional repository changes",
    );
  });
  it("accepts a concise heading and rejects unsafe or malformed titles", () => {
    expect(
      sessionTitleFromResponse(
        "## C++ Greeting Code Review\n\n```cpp\nint main() {}\n```",
      ),
    ).toBe("C++ Greeting Code Review");
    for (const text of [
      "plain response",
      "```cpp\n## Not a title",
      "## [Click](https://example.com)",
      "## C:/private/file",
      "## <script>bad</script>",
      `## ${"a".repeat(81)}`,
    ])
      expect(sessionTitleFromResponse(text)).toBeNull();
  });
  it("assembles partial streams but publishes only on official completion", () => {
    const tracker = new SessionTitleTracker();
    expect(
      tracker.observe({
        type: "agent_message_delta",
        itemId: "reply",
        text: 'Review details\n<nimbus_session_title>"C++ Greeting ',
      }),
    ).toBeNull();
    expect(tracker.observe({ type: "activity" })).toBeNull();
    expect(
      tracker.observe({
        type: "agent_message_delta",
        itemId: "reply",
        text: 'Code Review"</nimbus_session_title>',
      }),
    ).toBeNull();
    expect(
      tracker.observe({ type: "turn_completed", status: "failed" }),
    ).toBeNull();
    expect(
      tracker.observe({ type: "turn_completed", status: "interrupted" }),
    ).toBeNull();
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBe("C++ Greeting Code Review");
  });
  it("uses the final response instead of an earlier commentary heading", () => {
    const tracker = new SessionTitleTracker();
    tracker.observe({
      type: "agent_message_delta",
      itemId: "commentary",
      text: '<nimbus_session_title>"Initial Investigation"</nimbus_session_title>',
    });
    tracker.observe({
      type: "agent_message_delta",
      itemId: "final",
      text: 'Summary\n<nimbus_session_title>"Repository Overview"</nimbus_session_title>',
    });
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBe("Repository Overview");
  });
  it("names general chat from its actual topic, without repository placeholder instructions", () => {
    const tracker = new SessionTitleTracker(true, "chat");
    tracker.observe({
      type: "agent_message_delta",
      text: '<nimbus_session_title>"Repository overview"</nimbus_session_title>',
    });
    expect(
      tracker.observe({ type: "turn_completed", status: "completed" }),
    ).toBeNull();
    const prompt = sessionTitlePrompt(
      "Who are you?",
      "General conversation",
      false,
      "chat",
    );
    expect(prompt).toContain("no repository selected");
    expect(prompt).toContain("never use Repository overview");
    expect(prompt).toContain("hidden metadata");
    expect(
      sessionTitleFromMetadata(
        '<nimbus_session_title>"Nimbus Capabilities Overview"</nimbus_session_title>',
      ),
    ).toBe("Nimbus Capabilities Overview");
    for (const text of [
      "<nimbus_session_title>invalid</nimbus_session_title>",
      '<nimbus_session_title>"<script>bad</script>"</nimbus_session_title>',
      "## About Nimbus\nA reply",
    ])
      expect(sessionTitleFromMetadata(text)).toBeNull();
  });
  it("keeps streamed replies intact while hiding metadata even at every possible chunk boundary", async () => {
    const response =
      'I am Nimbus.\n\n```js\nif (a < b) console.log(a);\n```\n<nimbus_session_title>"Nimbus Capabilities Overview"</nimbus_session_title>';
    for (let split = 1; split < response.length; split++) {
      async function* source() {
        yield {
          type: "agent_message_delta",
          itemId: "answer",
          text: response.slice(0, split),
        };
        yield {
          type: "agent_message_delta",
          itemId: "answer",
          text: response.slice(split),
        };
        yield { type: "turn_completed", status: "completed" };
      }
      const titles: string[] = [];
      const output: string[] = [];
      for await (const event of presentSessionTurn(source(), true, (title) => {
        titles.push(title);
      }))
        if (event.type === "agent_message_delta") {
          expect(event.text).not.toContain("nimbus_session_title");
          output.push(event.text ?? "");
        }
      expect(output.join("")).toBe(
        response.slice(0, response.indexOf("<nimbus_session_title>")),
      );
      expect(titles).toEqual(["Nimbus Capabilities Overview"]);
    }
  });
  it("does not retitle follow-ups or failed turns and suppresses incomplete metadata", async () => {
    for (const [enabled, status] of [
      [false, "completed"],
      [true, "failed"],
    ] as const) {
      async function* source() {
        for (const text of 'Direct response.<nimbus_session_title>"Do Not Rename"</nimbus_session_title>')
          yield { type: "agent_message_delta", itemId: "answer", text };
        yield { type: "turn_completed", status };
      }
      const titles: string[] = [];
      let visible = "";
      for await (const event of presentSessionTurn(
        source(),
        enabled,
        (title) => {
          titles.push(title);
        },
      ))
        visible += event.text ?? "";
      expect(visible).toBe("Direct response.");
      expect(titles).toEqual([]);
    }
    async function* incomplete() {
      yield {
        type: "agent_message_delta",
        text: 'Answer.<nimbus_session_title>"Incomplete',
      };
      yield { type: "turn_completed", status: "failed" };
    }
    let visible = "";
    for await (const event of presentSessionTurn(incomplete(), true, () => {}))
      visible += event.text ?? "";
    expect(visible).toBe("Answer.");
  });
});
