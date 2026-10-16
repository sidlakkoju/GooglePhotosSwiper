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

## Large libraries

Measured on 2026-10-14 by replaying swipes headlessly against a real 33,909-item library state (metadata only, synthetic images):

| | Before | After |
| --- | --- | --- |
| First Flashbacks build with no saved order | 7.4 s | 70 ms |
| Main-thread work per swipe | ~84 ms | ~35 ms |
| Garbage collection per swipe | 6.6 ms | 1.7 ms |
| Local save per swipe | full 20 MB state | one 500-item chunk |
| JS heap after 40 swipes | 48 MB, flat | 48 MB, flat |

`test/flashbacks-order.test.mjs` guards a 30,000-item first build spread over thousands of memories, and `test/userscript-db-chunks.test.mjs` checks that a decision rewrites only its chunk.

## Safari and iPhone

Measured on 2026-10-15 in Playwright WebKit (iPhone-sized 440x956 at 3x, and 1440x900) against the demo build, and checked by eye in the iOS Simulator.

- The video spinner's infinite rotation is paused unless a video is loading. Before, it ran forever on the hidden spinner, which kept the compositor ticking at 60 fps on an idle deck.
- The next card shows under a drag through a `peek` class set once per gesture. It used to be `:has(>.top-card[style*="will-change"])`, which made WebKit re-check a `:has()` rule on every inline style write during a drag. `will-change` is also written once per gesture instead of every frame.
- On touch devices (`pointer:coarse`), glass that only ever sits over the ambient backdrop (header buttons, Freed counter, caption, order switcher, Going to Trash pill and swipe dock) uses `saturate()` without `blur()`. The ambient is already a blurred 48px canvas, so the blur pass is invisible: iOS Simulator screenshots of the deck differ by 0.28/255 on average. Everything that can sit over a photo or scrolling content keeps its blur, including the Settings and Going to Trash sheets: iOS 17 Safari leaves the deck visible behind them. Desktop keeps every blur.
- The ambient image is decoded before it is drawn, and its crossfade waits for the fly-off to finish so the two don't animate together. The next-card preview decodes off the main thread before a drag reveals it.

`test/demo.test.mjs` asserts that an idle deck requests no animation frames and runs no animations, and `test/userscript-theme.test.mjs` keeps per-frame inline styles out of `:has()` selectors.

## App audit (1.2.168)

Measured on 2026-10-16 with Playwright Chromium (CDP metrics, tracing, CPU profiles, heap snapshots) and WebKit, at 440x956 @3x touch and 1440x900, against the demo build and the mounted userscript with synthetic libraries. Medians of interleaved runs on a loaded machine; WebKit timers are 1ms coarse.

| Scenario | Before | After |
| --- | --- | --- |
| Decision task, 30k items, Chromium phone (p50 / p95) | 23.9 / 31.6 ms | 12.3 / 25.2 ms |
| Script per decision, 30k items, Chromium phone | 11.0 ms | 5.9 ms |
| Style recalcs / layouts per decision | 18 / 7 | 11 / 2 |
| Forced style or layout passes in ten decisions | 135 | 10 or fewer |
| Swipe-to-paint, 30k items, Chromium phone (p50 / p95) | 13.5 / 17.3 ms | 9.0 / 12.6 ms |
| Decision task, 3k items, WebKit phone (p50 / p95) | 5 / 9 ms | 3 / 6 ms |
| DOM nodes after 300 swipes (start 548) | 2,363 | 564 |
| Event listeners after 300 swipes (start 168) | 473 | 171 |
| Settings open with Stats, 30k items (first / later) | 56 / 43 ms | 21 / 7 ms |
| Stats computation, 30k items (Node) | 55 ms | 10 ms |
| Going to Trash open, 5,400 items | 8.7 s | 22 ms |
| Going to Trash, untick one item | 8.6 s | 55 ms |
| Going to Trash, open a preview | 11.6 s | 50 ms |
| Image requests when a preview opens | 3,293 | 38 |
| Drag frame, Chromium (style per frame / layouts) | 0.08 ms / 0 | 0.2 ms / 0 |
| Userscript evaluate (Chromium / WebKit) | 17.5 / 20 ms | 17.7 / 21 ms |
| Auto-loader start, 40ms cache read and 120ms version check | 167 ms | 122 ms |
| Auto-loader start, version check that never answers | 3.0 s | 1.0 s |

- Decisions no longer force layout. The media box size is cached and a `ResizeObserver` drops the cache when the box changes; the status toast restarts by switching between two identical keyframes instead of reading `offsetWidth`; the memory chip refits only when its text changes.
- A decision copies the item list once instead of three times, the swipe count is memoized per item list, the session storage total is one pass, the Undo preview stops copying the whole history, `reviewRows()` is skipped while Going to Trash is closed, the preview lookahead stops scanning once it has its photos and videos, and the queue pill rebuilds its three thumbnails only when they change.
- Local Undo history keeps the last 2,000 decisions, matching what sync already keeps, so each local save stays bounded.
- Evicted preview images release with `src=''`. `removeAttribute('src')` on an image that was never in the document leaked six nodes and a listener per swipe in Chromium, held by the document's viewport listeners.
- Stats format each quarter hour once (day boundaries in every time zone fall on quarter hours) instead of calling `formatToParts` for every decision, and capture dates reuse cached `Intl.DateTimeFormat`s.
- Going to Trash builds 96 tiles and adds more as you scroll, patches a tile in place when you tick or untick it, requests thumbnails at tile size (300px at 1x, 600px at 2x and above) instead of the card size, and its preview strip shows the 61 items around the current one. Before, every tile read the card's layout to size its URL, so building 5,400 tiles relaid the grid thousands of times.
- The auto-loader starts the version check while it reads the cached app and waits at most a second for it when a cached app exists; the running app already checks for updates when it opens.

Startup stays about 17ms in Chromium (9.5ms of it compiling 333KB) and 21ms in WebKit. Code-splitting Stats, the share sheet, sync and onboarding would save roughly a quarter of the compile, a few milliseconds, but would need a second fetch and eval path through Trusted Types on photos.google.com and break the single-file install, so the bundle stays whole. An eager-compile hint on `mountPhotosSwipe` measured no difference. The Worker already serves `/app.js` with Cloudflare's automatic Brotli (325KB to 85KB), `no-store` plus the `/version` check, and the loader keeps the app in GM storage, so a download happens only when the version changes.

Preview sizes match the box: previews request the card's CSS size, the sharp upgrade requests the box times the device pixel ratio (capped at 3 and 2560px), and only two sharp images are kept. The heap grows about 0.8KB per decision over 300 swipes, which is the bounded Undo history and Flashbacks resume list. These numbers come from synthetic media; real Google Photos downloads, video start-up and iPhone hardware were not measured.

`test/userscript-scale-e2e.test.mjs` checks the moving card, flat DOM nodes, listeners and heap over 200 decisions, the forced-layout count and the chunked Going to Trash grid. `test/stats.test.mjs` bounds Stats over 30,000 items, `test/flashbacks-order.test.mjs` bounds the history and `test/auto-loader.test.mjs` covers the overlapped and bounded version check.

## Moving card

The whole card moves under a drag: the frame, photo, memory chip, buttons and stamps translate and rotate together, and the next card sits underneath with its own frame. The frame lives on `.top-card` (a `::before` fill, an `::after` stroke and the shadow) instead of the stationary `#card`, which no longer clips. While a card is lifted it gets an opaque tint-matched fill so the next card does not show through its letterbox, and a `lifting` class on the overlay, set once per gesture, lets the card leave the panel without scrollbars. The fly-off copy stays clipped by the panel. Nothing in the moving layer uses `backdrop-filter`, and a drag frame still writes only transforms. Fullscreen keeps the old stage, where the photo moves inside the full-bleed frame.
