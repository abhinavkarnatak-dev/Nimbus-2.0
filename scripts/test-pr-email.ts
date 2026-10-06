import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import {
  emailConfiguration,
  renderPrEmail,
  sendPrEmail,
  type PrEmailData,
} from "../apps/web/lib/pr-email";

async function main() {
  try {
    loadEnvFile(resolve(__dirname, "../apps/web/.env.local"));
  } catch {
    /* Render or exported envs do not need a local file. */
  }
  const preview = process.argv.includes("--preview");
  const recipient = process.argv
    .find((arg) => arg.startsWith("--to="))
    ?.slice(5);
  if (!recipient && !preview)
    throw new Error("Pass --to=<recipient> explicitly");
  const event =
    process.argv.find((arg) => arg.startsWith("--event="))?.slice(8) ??
    "created";
  if (!["created", "merged", "closed"].includes(event))
    throw new Error("Invalid sample event");
  const config = emailConfiguration();
  if (!config && !preview)
    throw new Error(
      "Set RESEND_API_KEY and RESEND_FROM_EMAIL in the web environment",
    );
  const data: PrEmailData = {
    event: event as PrEmailData["event"],
    recipient: recipient ?? "preview@example.com",
    name: "Abhinav",
    title: "[TEST] Nimbus notification preview - not a real PR event",
    repository: "abhinavkarnatak-dev/Nimbus-2.0",
    number: 1,
    url: "https://github.com/abhinavkarnatak-dev/Nimbus-2.0/pull/1",
    taskId: "sample-email-preview",
  };
  // Test links are illustrative; this does not create a task or PR.
  const content = renderPrEmail(
    data,
    config?.origin ?? "https://nimbus.abhinavkarnatak.com",
  );
  if (preview) {
    const directory = resolve(process.cwd(), "../../.nimbus/email-preview");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${event}.html`), content.html);
    console.log(`Generated ${event} email preview without sending.`);
    return;
  }
  const id = await sendPrEmail(data, `nimbus-test-${randomUUID()}`, config!);
  console.log(`Resend accepted the test email. Message ID: ${id}`);
}
main().catch(() => {
  console.error(
    "Email test failed. Check configuration, recipient, and the Resend dashboard.",
  );
  process.exitCode = 1;
});
