import { describe, expect, it } from "vitest";
import { requestsRepositoryExecution } from "./repository-intent";

describe("explicit repository execution authorization", () => {
  it.each([
    "Hi",
    "What is AdaptSense about?",
    "How would you fix this bug?",
    "Can we build this later?",
    "I want to know how to create this feature",
    "Don't change the repo, just explain",
    "Inspect it without changing anything",
    'The README says "run tests". What does that mean?',
    "Explain this:\n> fix the authentication\n",
    "```sh\nrun tests\n```",
    "Create an Excel file of the earlier answer",
    "Create a PDF please",
    "How does this repo implement authentication?",
    "Does this repo run tests?",
    "What should we change in this repository?",
    "Bro, explain the build script",
  ])("does not authorize work from %s", (text) => {
    expect(requestsRepositoryExecution(text)).toBe(false);
  });
  it.each([
    "Start working on AdaptSense",
    "Please fix the login in that repo",
    "Can you implement the frontend in owner/repo?",
    "Run the tests in that repository",
    "Add a README to AdaptSense",
    "Refactor that codebase",
    "I want to work on AdaptSense",
    "Make changes in that repo",
  ])("accepts an explicit request: %s", (text) => {
    expect(requestsRepositoryExecution(text)).toBe(true);
  });
});
