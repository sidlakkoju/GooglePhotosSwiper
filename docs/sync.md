# Userscript sync setup

Sync is optional. IndexedDB remains the local source for review state and retains pending changes if the Worker is unreachable. No deployment was performed as part of this implementation.

## Worker setup

1. Authenticate Wrangler, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with Worker deployment and D1 permissions.
2. Generate separate private values for `SYNC_TOKEN` and `PAIRING_IP_KEY`, for example by running `openssl rand -hex 32` twice, and supply both as environment variables when running `bash scripts/deploy-worker.sh`.
3. Copy the deployed HTTPS Worker origin into each device's overlay under **Sync settings**, along with its token. Use the existing shared token only to bootstrap pairing. Select **Save and sync**.

The deployment script builds the userscript, looks up or creates the D1 database `photoswiper-sync`, substitutes its ID into a temporary config beside `wrangler.toml`, applies `worker/migrations` remotely, optionally writes the `SYNC_TOKEN` and `PAIRING_IP_KEY` Worker secrets, and deploys. It removes the temporary config on exit. The checked-in database ID remains `REPLACE_DATABASE_ID`. Omitting `SYNC_TOKEN` leaves an existing secret unchanged; device tokens continue working without `SYNC_TOKEN`; a Worker with no paired device needs the legacy secret to bootstrap. Supply `PAIRING_IP_KEY` when deploying before claiming codes; omitting it leaves an existing key unchanged. Deployment checks the Worker secret list and stops if the key is absent; see the setup steps above to supply it. Keep this key stable: it keys HMAC-SHA-256 hashes of Cloudflare-provided IP addresses for rate limiting.

Use a separate Worker/token for each person. The bearer token grants access to every account scope on that Worker. Account scopes use the userscript's existing account hash. Keep tokens private. Each paired device has a separate durable token and can be revoked independently.

## Device behavior

The URL and token are saved per device in userscript manager storage when available, with IndexedDB as a fallback. Clear both fields and save to turn sync off. Deleting IndexedDB preserves pairing when userscript manager storage is available.

Opening the overlay or saving review changes pulls remote decisions and sends pending local changes. Offline changes win for their item IDs on the next successful attempt; other remote decisions are merged. Sync failures leave local work intact and show a status message. Reopen the overlay or perform another action to retry. Concurrent edits of the same ID use the last successful write; undo history and progress use the last successful replacement. Avoid simultaneous review on multiple devices when preserving a single undo sequence matters.

Recovery checkpoints now sync batch IDs, media type, storage sizes, quota flags, item state, revisions, queue completion flags and cumulative lifetime freed bytes. Names, locations, preview URLs, Google authentication tokens, cookies, library pagination cursors, media bytes and album operation checkpoints stay local. Deploy the updated Worker before using the new checkpoint payload. No database migration is required.

When a paired device opens an empty local account store, startup pulls `/api/state`, rebuilds the checkpoint and Undo history, then scans library pages for fresh previews before saving and rendering cards. Reviewed IDs are applied during this scan. Recovery uses at most 12 pages per attempt; additional previews can be loaded with Load more. Items without recovered previews remain in counts and history but are excluded from the review deck until sighted. Fetch or rebuild failures leave the local store intact, show a non-blocking sync error and allow manual loading and retry.

Legacy checkpoints containing only `started` and `reviewed` can recover decisions and Undo revisions using a fresh library scan. They cannot recover Trash sizes or lifetime totals that were never sent to the Worker; those become recoverable after a successful sync from a device retaining that metadata. Undo history is bounded to the latest 2,000 entries; undo requires a matching eligible item revision. Lifetime freed is the cumulative recorded quota size of verified moves into Trash, rather than a measurement of permanent deletion or current account quota.

Requests use page `fetch` with credentials omitted and no privileged userscript APIs. Browser policy or Google Photos CSP can block these requests; local review continues and sync status reports the failure. Automated checks use fake fetch and an in-memory D1 fake, never real Google Photos.

## API

All routes except pairing claims and preflight require `Authorization: Bearer <device-token>`. Tokens have no expiry, are returned once at claim, and are stored only as SHA-256 hashes. Revoked devices immediately return 401. The legacy secret uses the existing digest-XOR constant-time comparison and authenticates as device `legacy` until revoked. Missing or incorrect authorization returns 401. Only `https://photos.google.com` receives CORS headers. Browser preflight is unauthenticated, allows Authorization and Content-Type, and rejects other origins with 403.

An optional `scope` query parameter isolates account records (default `default`). IDs and scopes accept 1–256 ASCII letters, digits, underscores or hyphens. Bodies are limited to 256 KiB and reject unsupported fields.

| Route | Payload/result |
| --- | --- |
| `GET /api/state` | `{decisions: [{id, decision}], progress, history}` |
| `PUT /api/decisions/:id` | `{decision: "keep" or "remove"}` |
| `DELETE /api/decisions/:id` | Remove the decision |
| `GET /api/progress` | Stored progress or `{}` |
| `PUT /api/progress` | `{started: boolean, reviewed: nonnegative integer, items?: [...], lifetimeFreed?: nonnegative integer}` |
| `PUT /api/undo` | `{history: [...]}` replaces history |
| `POST /api/undo` | `{action: "push", entry}` or `{action: "pop"}`; returns remaining history |

Undo entries contain only `{key, previous, decision, revision}`; `previous` permits null and decision is keep/remove. Push/pop updates use a single D1 SQL statement. `/photoswiper.user.js` remains public for GET and HEAD.

## Pairing and legacy migration

Apply `0002_pairing.sql` after the initial migration. It adds devices, pairing codes and rate counters without changing decisions or review state. `POST /api/pair/start` uses the current bearer token and returns `{id, code, short, expiresAt}`; `expiresAt` is Unix milliseconds. Save the opaque `id` for authenticated `GET /api/pair/status?id=...`, which returns `{claimed, name}` and only permits the issuing device to read status. No raw secret belongs in an API URL or query string.

On the new device, send `POST /api/pair/claim` with `{code, name, platform}` or `{short, name, platform}` in the JSON body, without authorization. Save the returned `{deviceId, token}` securely in that device's sync settings. The full code contains 128 random bits, the short code has six digits, and both expire after five minutes. Starting another code invalidates the previous code for that device. Claims and device creation run in one transaction. Tokens contain 256 random bits and cannot be retrieved again.

Claim requests are limited to 30 per IP per fixed UTC hour; starts are limited to 10 per device per hour. Wrong six-digit guesses increment every live code's failure counter, since a wrong guess cannot identify the intended code; five failures burn those codes. A global limit of 100 failed short guesses per hour disables short claims until the next hour, while full-code claims remain available. Limits return 429 with `Retry-After` in seconds. IPs are stored only as keyed hashes and old rate windows are pruned. Short failures always return `invalid`, including expired or used short codes, to avoid exposing whether a guess exists; full codes distinguish `invalid` from `expired_or_used`.

`GET /api/devices` returns `{devices, deviceId, suggestRevokeLegacy}` without token hashes. `PATCH /api/devices/:id` accepts `{name}`. `DELETE /api/devices/:id` revokes a device; unknown IDs return 404 for PATCH and DELETE, and repeated revocation succeeds without changing the revocation time; `POST /api/devices/revoke-others` revokes every device except the caller. Revoking an issuing device also prevents claiming its outstanding codes. Last-seen writes occur at most once per minute per device.

The old shared secret was shared in chat and must be considered exposed. Once a real device is paired, the sync status suggests retiring it. From the real device, revoke `legacy` with `DELETE /api/devices/legacy`. Confirm the legacy secret now returns 401, then run `wrangler secret delete SYNC_TOKEN --config worker/wrangler.toml`. The persistent revoked legacy row prevents re-enabling the same migration path even if the secret remains configured. Never delete that row to rotate credentials.

## QA smoke test

Use a separate preview Worker and D1 database containing only QA data, with separate secrets. Apply both migrations, start using its QA legacy secret, claim from a second device, read `/api/state` with the returned token, verify replay rejection, then revoke the QA legacy device and verify 401. Exercise Photos-origin preflight for the new routes. Never use Google Photos or the live Worker for this test. Automated regression tests execute the actual migrations and Worker SQL against in-memory SQLite; a remote preview smoke test requires preview deployment access and was not performed in this workspace.
