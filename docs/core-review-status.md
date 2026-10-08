# Core desktop review — October 7, 2026

## Branches and saved data

Video cropping is preserved at `codex/video-cropping` (snapshot `2b34843`). The active core app is on `main`, with `codex/core-review` retained as the implementation branch. Cropping UI, C shortcuts, exporter, upload providers, crop API endpoints and crop job banners are removed from core. Compatibility-only bridge exports reject crop work for any already-installed older worker; they perform no downloads or uploads.

The existing private database, account binding, sessions, browser credentials, crop job records and recovery files are retained. Generated copies remain excluded. Unfinished crop originals are quarantined from the ordinary review/removal queue and cannot be added to an album while their replacement remains unverified. Nothing was deleted from Google Photos, and no personal website or deployment changes were made.

## Updated behavior

- Storage selected for removal updates with each swipe, Keep instead and Undo, including in enlarged review. Sent batches remain in the total. Confirmed Trash has a separate estimate. Known Google quota metadata is used before file size, known free media count as zero, and unknown values are flagged. These counters do not claim to read Google's account storage meter.
- Every queue thumbnail opens the existing in-app viewer. Photos support fit, zoom and pan. Videos support native controls, scrubbing, looping and Space playback. F/Escape closes the viewer; queue inspection does not make review decisions.
- A fully verified album operation clears that batch from the working queue without resetting decisions, counters or album links. Partial/failed batches remain for retry. Clearance persists through reload, reimport, reconciliation and missing albums. Previously completed batches migrate to this behavior.
- Completed album banners do not stack. At most one actionable failed/pending operation appears. Toasts replace one another, expire after 2.8 seconds and dismiss on click.

## Verification

`npm test`: 40 passing, zero failures/skips. Covers authorization, pairing/recovery, import persistence, revision conflicts, Google response validation, partial album writes/retries, full-verification queue clearance, restart/reimport behavior, legacy migration, protected crop originals and storage accounting. `npm run check`: syntax and UI wiring pass for 14 files.

Chrome live checks verified bridge recovery with the existing account, loading older media, a real photo swipe/counter update/queue zoom to 125%, and a real video queue preview with a 16.37-second duration, playback, scrubbing, immediate Space pause/resume and automatic looping. Both temporary removal decisions were undone and the working queue returned to zero. No Google album writes or deletions were needed in this live check.

An isolated in-memory browser harness using generated media verified the album confirmation flow, full queue clearance with retained 3 MB total after reload, fullscreen arrow decisions, fullscreen Undo, photo zoom and video playback. Its album writes are local simulated acknowledgements, not a new live Google album test. Responsive checks covered 390×844, 320×568 and 844×390 with no horizontal overflow. These are browser viewport checks, not physical iPhone/Safari tests.

The Chrome localhost navigation security block required the user to open the tabs once. Subsequent checks ran autonomously; no additional extension-manager operation or permission expansion was required.

## Run

Run `npm start`, open `http://localhost:3000/` in Chrome, and keep the signed-in Google Photos tab open. Setup and daily-use instructions are at `/guide.html`.

For isolated browser QA, run `node test/fixtures/core-review-browser.mjs`, then open the test URL printed by that server. It uses synthetic media and an in-memory database and cannot send requests to Google.

## Compact autoplay follow-up

Regular review videos now automatically buffer and start muted, with native controls and looping. The existing enlarge control remains available after playback starts. Pausing survives ordinary workspace refreshes; opening the queue, swiping away, or signing out stops the compact player. Opening the enlarged view pauses the compact player, preserves muted state, and resumes the compact player on closing when it was previously playing. Stale asynchronous loads cannot replace a newer card; Undoing an end-of-review video decision starts that restored video again.

Synthetic browser checks verified autoplay without clicking Play, Space pause/resume, pause preservation through a connection refresh, compact/enlarged player exclusivity, resuming after closing enlarged view, stopping on queue navigation/decision, and autoplay after Undo. Live Chrome confirmed that all currently loaded unreviewed items were photos, so no personal decisions were changed for this follow-up test.

## Pagination follow-up

The supplied recording showed “50 items loaded” with the reviewed count unchanged at 315/315. That message counted raw page rows even when all rows were already reviewed, and a one-page read stopped without filling the deck. Separately, Refresh latest overwrote the older-library cursor with the head page's continuation.

The import controller now skips reviewed/overlapping pages and counts newly reviewable IDs separately from rows checked. It stops after at least 50 new review items, explicit exhaustion, a cursor loop, or a bounded 12-page scan; the result explains each outcome. Hidden generated/crop-protected items do not count as new work. Decisions and sent queue markers are preserved.

Bridge 1.3.1 tags latest refresh separately from older pagination. Metadata and cursor updates commit atomically; refresh preserves established progress, and stale concurrent or malformed cursor updates fail without changing data. Initial latest refresh can seed a fresh workspace. The existing bridge was reloaded once by the user, with no new permissions.

47 regression tests pass, including seven pagination cases. An isolated browser reproduction skipped two reviewed 50-row pages before revealing 50 new swipeable items and reported “50 new items to review · 150 library items checked.” Live Chrome verified Bridge 1.3.1, a recent refresh yielding zero new review items, and an unchanged older-library cursor. No Google media were deleted, and no review decisions were reset.

The final live Load more added 50 genuinely new items while retaining the previous 30, leaving 80 swipeable items and 315/395 reviewed. The new toast read “50 new items to review · 50 library items checked.” The current real video was playing automatically. User keep/remove decisions and the empty sent queue remained unchanged. Proof screenshots are saved locally in `test-results/pagination-fixed-20261007.png` and `test-results/pagination-synthetic-20261007.png`.
