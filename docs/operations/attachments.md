# Private message attachments

Users can attach up to **six mixed files per message**, independently for each
dashboard request and each follow-up. Picker, clipboard files and drag/drop are
supported. Each original is limited to 10 MiB. Audio/video is rejected.

Sent files appear as compact filename/size/download cards. PNG, JPEG, GIF, WebP,
AVIF and BMP also display lazy inline image previews, with a download-card fallback
if decoding fails. Previews use the same authenticated authorization checks and
short-lived R2 access as downloads. SVG/HTML and other active formats stay
download-only; no document iframe is embedded.

## Deployment

1. Run `pnpm db:migrate` against your deployment database **before deploying this
   version**. Migration 0015 adds message attachment metadata and the per-message
   six-file database constraint. Existing messages default to no attachments.
2. Set these server-only variables locally in `apps/web/.env.local` and on Render:
   `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   The endpoint is `https://ACCOUNT_ID.r2.cloudflarestorage.com`, without a bucket
   path. Bucket name is separate, e.g. `nimbus2-attachments`.
   `R2_ENDPOINT` must also be available during the web build so the browser's CSP
   allows uploads to that exact account origin.
3. Keep the bucket private. The R2 token needs Object Read & Write for this bucket
   only. Never put credentials in `NEXT_PUBLIC_*` variables or in chat.
4. In R2 bucket Settings > CORS policy, add:

```json
[
  {
    "AllowedOrigins": [
      "https://nimbus.abhinavkarnatak.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Add an R2 object lifecycle rule deleting objects with prefix `staging/` after
   one day. Do **not** apply it to `files/`: these are durable conversation files.
   Unsigned staging objects have no public access. Abandoned upload reservations
   stop counting towards the pending-upload allowance after 24 hours.

## Flow and limits

The browser extracts document text and uploads the original plus a bounded text
sidecar directly to R2 using five-minute presigned PUTs. Render verifies object
size, checks media signatures, then copies to immutable final keys. Sending binds
ready attachments to that one message atomically; retries retain the same message
and attachments. Removed/unready/foreign/already-bound files cannot be reused.

The agent receives file names, warnings and bounded text previews. A conversation-
scoped read tool can read the remaining extracted text or discover earlier files.
Repository turns can request a short-lived original download for processing inside
the existing sandbox. Attachments alone never create a sandbox, change Codex auth,
grant repository execution or authorize a PR. Download links require an authenticated
workspace member and expire after five minutes.

Text/code, CSV/JSON/XML/HTML and UTF-16 text are readable. PDF text and modern
DOCX/XLSX/PPTX/OpenDocument text are extracted in the browser, not on Render.
Text extraction is capped at 28,000 characters per file (120 KB sidecar), PDF parsing
at 60 pages and 30 seconds, expanded Office archives at 16 MB. The agent reads
4,000-character previews plus bounded 12,000-character chunks as needed.
Spreadsheet cells are text with cached values; formulas and macros never execute.
Images, legacy binary DOC/XLS, encrypted documents, scanned PDFs and other unsupported
binary formats can be stored/downloaded but have explicit extraction warnings.
OCR/vision is not included. Google Docs must be exported to a supported file first.
No file is publicly hosted, rendered as executable HTML, or treated as instructions.

## Validation

`pnpm --filter @nimbus/web test` includes attachment policy/storage/reader tests.
PostgreSQL route coverage is opt-in with `NIMBUS_ATTACHMENT_DATABASE_TEST=true`
and a **disposable** `DATABASE_URL`; never point tests at production.
Browser coverage is in `tests/e2e/attachments.spec.ts`, with mocked upload storage.
Run with `NIMBUS_ATTACHMENT_E2E=true`, a seeded disposable localhost database,
local auth, and the fake coding provider. Adding `NIMBUS_ATTACHMENT_R2_LIVE=true`
and the R2 environment enables a real browser upload, message binding, history
download and cleanup test. The R2 smoke tests clean only their unique test keys.
