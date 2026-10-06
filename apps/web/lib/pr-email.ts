import { z } from "zod";

export const PrEmail = z
  .object({
    event: z.enum(["created", "merged", "closed"]),
    recipient: z.email(),
    name: z.string().max(500),
    title: z.string().max(1000),
    repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    number: z.number().int().positive(),
    taskId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.origin === "https://github.com" &&
        !url.username &&
        !url.password &&
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/.test(url.pathname) &&
        !url.search &&
        !url.hash
      );
    }),
  })
  .superRefine((value, ctx) => {
    if (
      value.url !==
      `https://github.com/${value.repository}/pull/${value.number}`
    )
      ctx.addIssue({
        code: "custom",
        message: "PR URL does not match the repository",
      });
  });
export type PrEmailData = z.infer<typeof PrEmail>;

export function emailConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return null;
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (
    !apiKey.startsWith("re_") ||
    !z.email().safeParse(address).success ||
    /[\r\n]/.test(from)
  )
    throw new Error("Invalid Resend configuration");
  const origin = new URL(env.AUTH_URL ?? "http://localhost:3000");
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid email application URL");
  return { apiKey, from, origin: origin.origin };
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const wording = {
  created: {
    title: "Your pull request is ready",
    status: "Ready for review",
    description:
      "Nimbus has created a pull request for your task. Review the changes on GitHub when you're ready.",
    color: "#7960e9",
  },
  merged: {
    title: "Your pull request was merged",
    status: "Merged",
    description:
      "Your changes have been merged on GitHub. You can return to Nimbus to continue building.",
    color: "#7960e9",
  },
  closed: {
    title: "Your pull request was closed",
    status: "Closed without merging",
    description:
      "This pull request was closed on GitHub without being merged. Your Nimbus conversation is still available.",
    color: "#687080",
  },
};

export function renderPrEmail(input: PrEmailData, origin: string) {
  const data = PrEmail.parse(input);
  const copy = wording[data.event];
  const taskUrl = `${origin}/tasks/${encodeURIComponent(data.taskId)}`;
  const subject = `[Nimbus] PR #${data.number} ${data.event}: ${data.title}`
    .replace(/[\r\n]/g, " ")
    .slice(0, 250);
  const text = `${copy.title}\n\nHi ${data.name || "there"},\n\n${copy.description}\n\n${data.repository} #${data.number}\n${data.title}\n\nView pull request: ${data.url}\nOpen Nimbus task: ${taskUrl}\n\nYou received this transactional update because you started this task in Nimbus.`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>${escape(copy.title)}</title></head><body style="margin:0;background:#f5f5fa;font-family:Arial,Helvetica,sans-serif;color:#20212a"><div style="display:none;max-height:0;overflow:hidden">${escape(copy.title)} - ${escape(data.repository)} #${data.number}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e7e5ef;border-radius:20px"><tr><td style="padding:32px"><div style="font-size:22px;font-weight:700;color:#7960e9">Nimbus <span style="font-size:12px;font-weight:400;color:#777987">CLOUD CODING AGENT</span></div><p style="margin:30px 0 16px;font-size:12px;font-weight:700;color:${copy.color};text-transform:uppercase;letter-spacing:1px">${copy.status}</p><h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;letter-spacing:-.6px">${copy.title}</h1><p style="font-size:16px;line-height:1.7;color:#626574">Hi ${escape(data.name || "there")},<br>${escape(copy.description)}</p><div style="margin:24px 0;padding:20px;background:#f8f7fe;border:1px solid #e9e5fa;border-radius:12px"><p style="margin:0 0 10px;font-size:13px;color:#777987">${escape(data.repository)} &nbsp; #${data.number}</p><p style="margin:0;font-size:18px;font-weight:600;line-height:1.5;overflow-wrap:anywhere">${escape(data.title)}</p></div><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:9px;background:#7960e9"><a href="${escape(data.url)}" style="display:inline-block;padding:15px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">View pull request</a></td></tr></table><p style="margin-top:22px;font-size:14px"><a href="${escape(taskUrl)}" style="color:#7960e9;text-decoration:none">Open your Nimbus task &#8594;</a></p><p style="margin:30px 0 0;padding-top:20px;border-top:1px solid #eeedf4;font-size:12px;line-height:1.6;color:#9294a1">You received this transactional update because you started this task in Nimbus.</p></td></tr></table><p style="font-size:12px;color:#9294a1">Nimbus - Build in the cloud. Stay in control.</p></td></tr></table></body></html>`;
  return { subject, html, text };
}

export class EmailDeliveryError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export async function sendPrEmail(
  data: PrEmailData,
  idempotencyKey: string,
  config: NonNullable<ReturnType<typeof emailConfiguration>>,
  transport: typeof fetch = fetch,
) {
  const content = renderPrEmail(data, config.origin);
  let response: Response;
  try {
    response = await transport("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [data.recipient],
        ...content,
      }),
    });
  } catch {
    throw new EmailDeliveryError(true, "Resend request timed out or failed");
  }
  if (!response.ok)
    throw new EmailDeliveryError(
      response.status === 429 ||
        response.status === 408 ||
        response.status >= 500,
      `Resend HTTP ${response.status}`,
    );
  const result = (await response.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  if (typeof result?.id !== "string")
    throw new EmailDeliveryError(
      true,
      "Resend response did not confirm acceptance",
    );
  return result.id;
}
