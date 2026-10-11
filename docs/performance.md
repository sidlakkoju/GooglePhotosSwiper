# Swipe performance

Decisions and Undo update the card in memory before storage or network work starts. A single local writer coalesces rapid changes and retains failed writes for retry. The account lease belongs to the open review session; another tab must wait until that session closes. Account checks still precede album and Trash operations and run when the page becomes visible.

Sync pushes after two seconds idle or ten decisions, using the Worker’s atomic `PUT /api/decisions` batch route. Open, focus and the periodic refresh pull remote state. History uploads occur only when dirty. Deploy the matching Worker before using the rebuilt userscript with sync enabled.

Photos use viewport and capped DPR sizing with CDN buckets. The next three previews load with two concurrent fetches; constrained devices use two slots, including the previous photo for Undo. Displayed elements leave the buffer before eviction. Hidden pages and pagehide discard speculative media. Video URLs have a thirty-minute cache, one RPC runs at a time, and desktop warms metadata for one upcoming video. iPhone skips the speculative video decoder. Posters remain visible until the first video frame is ready.

Set `localStorage.psDebug = '1'` in the Google Photos page to print swipe-to-paint p50/p95, buffer hit rate, local write duration and video first-frame duration. Clear that setting to disable logging. Video stream URLs remain unchanged: transcode suffix compatibility and first-frame byte comparisons require a separate authorized measurement against Google Photos.

Run unit and mounted UI regressions with Node 22:

```sh
node --test test/userscript-performance.test.mjs test/userscript.test.mjs test/sync.test.mjs
node scripts/check.mjs
```

`test/userscript-perf-e2e.test.mjs` uses Playwright Chromium, intercepts every request, and runs twenty synthetic photo swipes at one per second with Fast 3G conditions. It asserts p95 below 100ms after the first three swipes and verifies the final image remains loaded. It skips when Playwright is unavailable; install Playwright and its Chromium browser in the local test environment to run it:

```sh
node --test test/userscript-perf-e2e.test.mjs
```

These synthetic tests do not establish real Google Photos download or video start-up timings.
