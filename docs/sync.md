# Userscript sync setup

Sync is optional. IndexedDB remains the local source for review state and retains pending changes if the Worker is unreachable. No deployment was performed as part of this implementation.

## Worker setup

1. Authenticate Wrangler, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with Worker deployment and D1 permissions.
2. Generate separate private values for `SYNC_TOKEN` and `PAIRING_IP_KEY`, for example by running `openssl rand -hex 32` twice, and supply both as environment variables when running `bash scripts/deploy-worker.sh`.
3. Open Photos Swipe and choose **Sign in with Google** on each device. Google sign-in uses the public web client ID `717807985103-6dfnvq5vpf0qa1ntjsgjcpr3oo30inc8.apps.googleusercontent.com` and the authorized JavaScript origin `https://photoswiper-sync.sidlakkoju.workers.dev`. No client secret or authorization-code exchange is used. Old installed clients retain the shared-token and pairing endpoints; new clients use only Google sign-in.

The deployment script builds the userscript, looks up or creates the D1 database `photoswiper-sync`, substitutes its ID into a temporary config beside `wrangler.toml`, applies `worker/migrations` remotely, optionally writes the `SYNC_TOKEN` and `PAIRING_IP_KEY` Worker secrets, and deploys. It removes the temporary config on exit. The checked-in database ID remains `REPLACE_DATABASE_ID`. Omitting `SYNC_TOKEN` leaves an existing secret unchanged; device tokens continue working without `SYNC_TOKEN`; a Worker with no paired device can bootstrap through Google sign-in. Supply `PAIRING_IP_KEY` when deploying before claiming codes; omitting it leaves an existing key unchanged. Deployment checks the Worker secret list and stops if the key is absent; see the setup steps above to supply it. Keep this key stable: it keys HMAC-SHA-256 hashes of Cloudflare-provided IP addresses for rate limiting.

Google accounts are keyed by the verified ID token `sub`, never email. New accounts get isolated random sync spaces; devices signing into the same account join the same space. The first sign-in from a paired device attaches its existing space. Device listing and revocation are restricted to the authenticated space. Unlinked legacy pairing retains its existing scopes; linking migrates the current scope into the account space and brings the paired devices into that space. Keep pairing tokens private.

## Device behavior

Google-issued device tokens and the sign-in state are kept only in private GM storage. Google sync requires GM storage and `GM.xmlHttpRequest`; `GM.openInTab` supports the foreground fallback. Existing pairing retains its IndexedDB fallback. The Worker origin is fixed in the UI. Choose Sign out to turn sync off while keeping local progress. Deleting IndexedDB preserves pairing when userscript manager storage is available.

Opening the overlay or saving review changes pulls remote decisions and sends pending local changes. The Worker merges each photo using the last server write, including an explicit Keep replacing remove. The client uses the accepted server decisions; other remote decisions are merged. Sync failures leave local work intact and show a status message. Reopen the overlay or perform another action to retry. Decision ownership and server timestamps are stored separately. Undo history is private to each device, and a device can clear only its own decision. Visible devices poll every four seconds and on focus to remove reviewed items from their deck. Before each Trash batch, the userscript checks that the server still records remove for every candidate; failed checks stop the operation.

Recovery checkpoints now sync batch IDs, media type, storage sizes, quota flags, item state, revisions, queue completion flags and cumulative lifetime freed bytes. Names, locations, preview URLs, Google authentication tokens, cookies, library pagination cursors, media bytes and album operation checkpoints stay local. Deploy the updated Worker before using the new checkpoint payload. The additive `0004_google_sync.sql` migration adds account mappings, sign-in states and decision ownership without rewriting existing data. The `0006_google_claim_proof.sql` migration adds claim proof and source device fields. The existing deployment script applies migrations before deployment.

When a paired device opens an empty local account store, startup pulls `/api/state`, rebuilds the checkpoint and Undo history, then scans library pages for fresh previews before saving and rendering cards. Reviewed IDs are applied during this scan. Recovery uses at most 12 pages per attempt; additional previews can be loaded with Load more. Items without recovered previews remain in counts and history but are excluded from the review deck until sighted. Fetch or rebuild failures leave the local store intact, show a non-blocking sync error and allow manual loading and retry.

Legacy checkpoints containing only `started` and `reviewed` can recover decisions and Undo revisions using a fresh library scan. They cannot recover Trash sizes or lifetime totals that were never sent to the Worker; those become recoverable after a successful sync from a device retaining that metadata. Undo history is bounded to the latest 2,000 entries; undo requires a matching eligible item revision. Lifetime freed is the cumulative recorded quota size of verified moves into Trash, rather than a measurement of permanent deletion or current account quota.

With GM support, sync requests use `GM.xmlHttpRequest`, outside the Google Photos page context. Legacy environments keep the existing fetch fallback. Automated checks generate RSA keys in-test and mock Google JWKS, the Worker and Photos; they contact no live Google services.

## Google sign-in

`POST /auth/session` creates a five-minute state with a server-generated nonce and optionally authenticates the current pairing token to link its space. `/auth/start` renders the Google Identity Services button on the Worker origin, requesting only basic OpenID/email identity. The Photos account email is a login hint; the saved account email is shown with a mismatch warning and a switch-account button.

`POST /auth/complete` accepts the GIS ID token only from the Worker origin. It checks the RS256 signature against cached Google JWKS, audience, issuer, expiry, nonce and subject. No Google token is persisted. Completion is one-time. `POST /auth/complete` returns a one-time sign-in code only to the browser completing sign-in. Old clients may claim with that code; the current userscript creates an automatic session and polls by its private state, without code entry. `POST /auth/claim` requires the code and, when linking, the original device token before consuming the state and linking the space. It rotates the device token while preserving the device ID for linking and same-account sign-in, so decision ownership and undo history survive. New devices and account switches receive a new device ID. Only hashes of codes and device tokens are stored. Expired or replayed claims fail. Email is display metadata only.

The current userscript opens Google sign-in in the same tab with an allowlisted Photos return URL. After completion, `/auth/return` sends a 302 back to that URL. The private pending state claims the completed session on reload without code entry and is cleared after success, failure or expiry. `0007_google_return.sql` adds the return URL to the five-minute pending session; legacy token and pairing endpoints remain available to old clients.

## API

All routes except pairing claims and preflight require `Authorization: Bearer <device-token>`. Tokens have no expiry, are returned once at claim, and are stored only as SHA-256 hashes. Revoked devices immediately return 401. The legacy secret uses the existing digest-XOR constant-time comparison and authenticates as device `legacy` until revoked. Missing or incorrect authorization returns 401. Only `https://photos.google.com` receives CORS headers. Browser preflight is unauthenticated, allows Authorization and Content-Type, and rejects other origins with 403.

An optional `scope` query parameter isolates unlinked legacy records (default `default`). Account-linked devices always use their shared space, independent of the client scope hint. IDs and scopes accept 1–256 ASCII letters, digits, underscores or hyphens. Bodies are limited to 256 KiB and reject unsupported fields.

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
