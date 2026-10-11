# Development and testing

Run all commands from the repository root with Node.js 22.13 or newer. No `npm install` step is required.

```sh
npm start
npm test
npm run check
```

`npm start` serves the app on loopback port 3000 and uses the private database under `.data/`. Browser assets are read from disk; reload the app after editing them. Restart the server for backend changes. Reload the unpacked Chrome extension after extension changes, then reload the app tab.

`npm test` executes Node's test runner across `test/*.test.mjs`. The core suite has 48 tests covering authentication, pairing, account binding, persistence/revisions, import pagination, media-host validation, preview buffering, partial album writes/retries, reconciliation, queue membership and storage estimates. HTTP tests require permission to listen on loopback ports in restricted development environments.

`npm run check` validates JavaScript syntax, the extension manifest and references from app code to HTML element IDs. Tests also verify that every public browser module is served by the backend's asset allowlist. Add new modules to that allowlist.

## Isolated UI checks

```sh
node test/fixtures/core-review-browser.mjs
```

Open the printed URL at `localhost:3001`. This fixture uses generated image/video media, an in-memory database and a simulated bridge. Album acknowledgements stay in memory; it does not use Google Photos credentials or make Google requests. Stop it with Ctrl+C. It exercises the real frontend/server while replacing the external transport.

For the overlapping-page regression:

```sh
node test/fixtures/core-review-browser.mjs --pagination
```

This starts with 50 reviewed items, returns two reviewed pages, then 50 new review items. A single Load more should produce 50 swipeable items and report 150 library rows checked.

Check compact/fullscreen playback, Space immediately after scrubbing, looping, swipe/Undo, queue photo/video inspection, zero storage for an empty queue, reload persistence and responsive layouts. Viewport tests do not establish physical iPhone/Safari compatibility.

## Branch workflow

`main` contains current core fixes. `codex/core-review` is the initial core-isolation checkpoint. `codex/video-cropping` preserves the experimental implementation; it has its own handoff/research docs and native export tests. It has not absorbed later core fixes and is not a production alternative to `main`.

Before trying that branch with real local state, stop the running app/extension, make a private `.data` backup and use a separate checkout/database for experiments. Only one server can own port 3000. Never attach a second branch's app process to the active personal database concurrently. Synthetic media is the default for write/export experiments; personal Google media deletion requires separate explicit authorization.

Keep private runtime files out of commits. Git changes do not back up SQLite, browser caches, pairing credentials or media recovery files. Preserve third-party attribution when editing the Photos API adapter.
