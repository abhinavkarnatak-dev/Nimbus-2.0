# Public URL reading

Nimbus exposes `nimbus_read_url` to both general chat and repository turns.
Codex web search remains unchanged and available for discovery. Supplied links
should be read with the URL tool before their content is analyzed.

## Deployment

No migration, new executor service or local Chromium installation is needed.
Plain public HTML, JSON and text use a bounded direct fetch. Pages requiring
JavaScript fall back to Jina Reader's remotely hosted browser. Public URLs sent
to that fallback are shared with Jina; Nimbus does not forward cookies, Codex
credentials, GitHub tokens or user authentication. This is not a private-page
reader. Do not submit private or signed download links.

`JINA_API_KEY` is optional and server-only (web service environment). Without
it, anonymous remote reading is subject to Jina's domain/rate restrictions,
and iframe reading is not enabled. Add a key to enable authenticated limits and
iframe extraction. A key is not a guarantee of access: login walls, CAPTCHA,
site restrictions, unavailable posts and provider outages can still prevent
reading. Do not claim the Claude artifact or X example is fixed merely because
the outer page opens in a browser.

Provider references: [Reader documentation](https://github.com/jina-ai/reader)
and [live API documentation](https://r.jina.ai/docs).

## Bounds and safety

- Only public HTTP/HTTPS, standard ports, no URL credentials.
- Reject private/reserved IPs, including IPv4-mapped IPv6 and mixed DNS answers.
- Pin validated DNS per direct connection; revalidate up to three redirects.
- At most two in-flight reads per web process, four unique URLs per message.
- 1 MB response/download cap, 24,000 returned characters, 40-second total
  deadline and 10-second direct-fetch deadline; user cancellation aborts reads.
- Cache only within a single turn, with explicit truncation/partial-page flags.
- Remote browser runs outside Render; no E2B coding workspace starts for a read.
- Website content is untrusted data, never execution or publishing permission.

The remote service owns its browser's redirect/subresource network isolation;
Nimbus validates the submitted target and returned source URL, and rejects
unsafe direct redirects without forwarding them to the remote service. Nimbus
never exposes a general-purpose unauthenticated URL proxy route.

## Existing conversations

The pinned Codex runtime binds dynamic tools at thread creation. Existing
provider slots upgrade once on the next turn, using the existing checkpointed
conversation replacement mechanism. Visible messages are not deleted; recent
conversation context is carried forward. Repository sessions keep the same
verified remote workspace, per-message model/effort and PR authorization. This
does not reset Codex login or grant execution to general chat.

## Verification

Run the URL reader, general-chat, internal Codex route, Codex provider and shared
activity tests. Then test a static page, a JavaScript/iframe page and a restricted
social link in Nimbus. Confirm actual returned content, not just HTTP 200 or a
"Read" activity label. Restricted content should report a bounded failure,
while the surrounding chat turn can still finish normally. This reader covers
one page, not an entire thread or every linked document, and does not read text
that exists only inside images or video.
