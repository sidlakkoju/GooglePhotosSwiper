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
- On touch devices (`pointer:coarse`), glass that only ever sits over the ambient backdrop (header buttons, Freed counter, caption, order switcher, Going to Trash pill, swipe dock, and the full-screen Settings and Going to Trash sheets) uses `saturate()` without `blur()`. The ambient is already a blurred 48px canvas, so the blur pass is invisible: simulator screenshots differ by 0.38/255 on average. Surfaces that can sit over a photo or scrolling content (order menu, share sheet, onboarding card, Settings header, trash preview) keep their blur. Desktop keeps every blur.
- The ambient image is decoded before it is drawn, and its crossfade waits for the fly-off to finish so the two don't animate together. The next-card preview decodes off the main thread before a drag reveals it.

`test/demo.test.mjs` asserts that an idle deck requests no animation frames and runs no animations, and `test/userscript-theme.test.mjs` keeps per-frame inline styles out of `:has()` selectors.
