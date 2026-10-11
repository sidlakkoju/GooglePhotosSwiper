# Userscript sync setup

Sync is optional. IndexedDB remains the local source for review state and retains pending changes if the Worker is unreachable. No deployment was performed as part of this implementation.

## Worker setup

1. Authenticate Wrangler, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with Worker deployment and D1 permissions.
2. Generate a private token, for example with `openssl rand -hex 32`, and supply it as the environment variable `SYNC_TOKEN` when running `bash scripts/deploy-worker.sh`.
3. Copy the deployed HTTPS Worker origin into each device's overlay under **Sync settings**, along with the same token. Select **Save and sync**.

The deployment script builds the userscript, looks up or creates the D1 database `photoswiper-sync`, substitutes its ID into a temporary config beside `wrangler.toml`, applies `worker/migrations` remotely, optionally writes the `SYNC_TOKEN` Worker secret, and deploys. It removes the temporary config on exit. The checked-in database ID remains `REPLACE_DATABASE_ID`. Omitting `SYNC_TOKEN` leaves an existing secret unchanged; a new Worker without the secret returns HTTP 500 for API calls.

Use a separate Worker/token for each person. The bearer token grants access to every account scope on that Worker. Account scopes use the userscript's existing account hash. Keep the token private and rotate the Worker secret and device settings together.

## Device behavior

The URL and token are saved per browser/device in the `settings` store of `photos-swipe-userscript` IndexedDB on the Google Photos origin. Clear both fields and save to turn sync off. Clearing site data also clears these settings and local state.

Opening the overlay or saving review changes pulls remote decisions and sends pending local changes. Offline changes win for their item IDs on the next successful attempt; other remote decisions are merged. Sync failures leave local work intact and show a status message. Reopen the overlay or perform another action to retry. Concurrent edits of the same ID use the last successful write; undo history and progress use the last successful replacement. Avoid simultaneous review on multiple devices when preserving a single undo sequence matters.

Imported metadata, preview URLs, Google authentication tokens, cookies, library pagination cursors, media bytes and album operation checkpoints stay local. Remote reviewed IDs are applied as their items are loaded on another device. Each device scans its own library pages; sync reports the shared reviewed count instead of sharing Google pagination tokens. Undo history is bounded to the latest 2,000 entries; undo requires the matching item to be loaded and eligible locally.

Requests use page `fetch` with credentials omitted and no privileged userscript APIs. Browser policy or Google Photos CSP can block these requests; local review continues and sync status reports the failure. Automated checks use fake fetch and an in-memory D1 fake, never real Google Photos.

## API

All data routes require `Authorization: Bearer <SYNC_TOKEN>`. The Worker compares fixed-size SHA-256 digests in constant time. Missing or incorrect authorization returns 401; an unset secret returns 500. Only `https://photos.google.com` receives CORS headers. Browser preflight is unauthenticated, allows Authorization and Content-Type, and rejects other origins with 403.

An optional `scope` query parameter isolates account records (default `default`). IDs and scopes accept 1–256 ASCII letters, digits, underscores or hyphens. Bodies are limited to 256 KiB and reject unsupported fields.

| Route | Payload/result |
| --- | --- |
| `GET /api/state` | `{decisions: [{id, decision}], progress, history}` |
| `PUT /api/decisions/:id` | `{decision: "keep" or "remove"}` |
| `DELETE /api/decisions/:id` | Remove the decision |
| `GET /api/progress` | Stored progress or `{}` |
| `PUT /api/progress` | `{started: boolean, reviewed: nonnegative integer}` |
| `PUT /api/undo` | `{history: [...]}` replaces history |
| `POST /api/undo` | `{action: "push", entry}` or `{action: "pop"}`; returns remaining history |

Undo entries contain only `{key, previous, decision, revision}`; `previous` permits null and decision is keep/remove. Push/pop updates use a single D1 SQL statement. `/photoswiper.user.js` remains public for GET and HEAD.
