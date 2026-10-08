# Photos Swipe — local desktop

Review Google Photos one photo or video at a time. Left swipe queues a candidate; right swipe keeps it. Decisions persist in a private local SQLite database. Sending the queue adds candidates to a review album and verifies membership before acknowledging each candidate. **There is no photo deletion operation in this build.** Removing photos remains a deliberate action in Google Photos.

## Run locally

Requires Node.js 22.13 or newer; no npm dependencies or paid services.

1. Run `npm start` in this directory. The server listens only on `127.0.0.1:3000`.
2. Open the URL saved in `.data/local-login-url`, or open `http://localhost:3000` and enter the code in `.data/access-code`. Do not share these files. A session lasts 12 hours.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repo's `extension` directory. Reload the app tab after installation.
4. In the app, click **Google Photos → Generate pairing code**.
5. Open Google Photos in another Chrome tab, signed into the intended account. While that tab is active, open the Photos Swipe extension popup, enter the pairing code, and pair. The code expires after five minutes and can be used once.
6. Return to the app and click **Check connection**, close the dialog, then **Load 50 more**. Leave the paired Google Photos tab open. Import subsequent batches to reach older media; **Refresh latest** rescans recent media without discarding decisions.
7. Review with the arrow keys, buttons, or dragging the card. Press **Z** to undo the last decision in this tab. Open the removal queue to change a candidate to **Keep instead**.
8. Choose **Send to review album** and confirm the candidate count. Keep both tabs open while it runs. Full verification clears that batch from the queue and offers a link to the album. Interrupted updates preserve checkpoints and can be retried.

The extension currently requires the app at exactly `http://localhost:3000`; use that hostname and default port. It does not work in the Codex in-app browser. Reopen the popup to pair a new Google Photos tab if the paired tab closes. Switching Google accounts is rejected; use a separate local workspace for a different account.

Removal queue thumbnails load independently from the browser preview cache after a reload, with uncached previews loaded as you scroll. Click a photo or video thumbnail to enlarge it inside the app. Queue videos start playback and use the same controls, looping and Space shortcut as the review viewer.

Press F, double-click the preview, or use the enlarge button to open a photo or video in the larger viewer. Videos autoplay muted and loop in the regular review card; use the player volume control for sound. Space plays or pauses videos in both the review card and enlarged viewer. F also closes the viewer. Scroll, pinch, or use +/− to zoom; drag to pan. Fit resets the view and Escape closes it. In the enlarged review viewer, left/right arrows queue removal or keep, and the next item appears without closing. Z and the Undo button reverse the decision. Swipe photos at fit zoom; zoomed drags pan. Use the separate swipe area beneath videos to preserve native scrubbing. Queue thumbnail previews remain read-only.

Video playback requires a live connection and may fall back to opening Google Photos.

## Core review and feature branches

The core app is on `main` (also retained as `codex/core-review`). Cropping is preserved separately on `codex/video-cropping`, snapshot `2b34843`. Core has no crop UI, upload provider, or crop API routes. Private SQLite data, crop jobs, media recovery files and generated-copy exclusions remain intact. Unfinished crop originals are quarantined rather than sent for removal with an unverified replacement.

The storage counters update with each swipe/undo and persist across album sends. **Selected · estimated savings** includes all removal decisions, including sent batches. **In Trash · estimated savings** includes manual deletions confirmed by the read-only check. These are estimates, not a Google account storage-meter reading: known quota bytes take precedence; otherwise file size is used, with unknown sizes flagged and known non-quota media counted as zero.

On successful full album verification, that batch leaves the removal queue permanently while keeping its review decisions and album link. Partial or failed updates retain their candidates for retry. Reimports, restarts, and missing albums do not refill a successfully sent queue. An existing completed batch is migrated to the same behavior on first startup.

Completed job banners no longer accumulate. One active or failed operation remains visible when actionable; transient messages replace one another, disappear after 2.8 seconds, and dismiss on click.

## After manual deletion

Open **Removal queue → Check deleted items** after moving items to Trash in Google Photos. The extension performs only reads. Confirmed Trash matches leave the active queue and review stack, with decisions retained locally. Album acknowledgements are cleared only when the item state and membership are verified; sent batches remain cleared from the working queue. Unknown/failed checks leave items unchanged. Reimporting a restored photo makes it active again with its saved decision. Permanent purges before a confirmed Trash check cannot be inferred from absence alone.

Reload the extension card after updating its code, then refresh the app tab to enable this command. No new host permissions are required. The personal-site experiment is planned in [docs/personal-site-integration.md](docs/personal-site-integration.md); no website files were changed or deployed.

## Data and permissions

`.data/` contains the local access code, hashed app sessions and extension credentials, account hash/label, imported metadata, decisions, and album job checkpoints. It is ignored by Git. Preview images are cached in this browser's IndexedDB; signing out locks the app but does not erase that cache. This is designed for a trusted personal computer.

The extension reads Google Photos using the active browser session. Google login cookies and page authentication tokens remain in Chrome and are never sent to the local server. The server stores media identifiers and preview URLs; treat the database as private. The extension can access Google Photos, Google media preview hosts, and localhost. Pairing grants access only to this local workspace. **Revoke pairing** in the app invalidates the credential; **Forget pairing** in the popup removes its local copy. Remove the extension through Chrome when finished.

Google Photos' undocumented web API can change without notice. The provider implements a narrow allowlist: identity, library/metadata reads, media previews, album discovery/creation, album membership reads, and adding media to an album. It rejects unsupported commands, including trash and permanent deletion. Album additions do not free storage. Keeping a candidate after it was added to the album does not automatically remove it from that album.

## Validation

`npm test` covers persistent state, revision conflicts, authorization, pairing expiry/replay/revocation, URL validation, partial album checkpoints and retries, and provider response handling with mocked Google responses. `npm run check` checks JavaScript syntax, UI element references, and the extension manifest.

Live Google Photos testing has confirmed importing 100 items across two pages with filenames/sizes and creating a private review album containing our synthetic test PNG. Google now uses photos.fife.usercontent.google.com for some previews, and album media IDs differ from library IDs; the provider supports that host and verifies membership with Google’s stable content identifiers. Live verification also confirmed real preview loading, video playback, and reconciling the existing review album without adding a duplicate. Keep/undo and decisions after reimport/reload were also verified. The generated 2 KB test image remains in the review album; the removal queue was cleared after testing. Live read-only reconciliation also matched 10 imported items already in Trash, cleared the active removal queue, handled an unavailable review album, and persisted the result after reload. Mock tests cannot confirm future changes to Google's private response format.

## Implementation and future deployment

`public/` is the UI; `server.mjs` provides local authentication and JSON endpoints; `lib/store.mjs` persists state using Node's SQLite module; `extension/` bridges Chrome's Google Photos session to this workspace. No hosted service is deployed by this project. The local implementation costs nothing to host. A later hosted version can use a static frontend and authenticated API/database; it must replace the localhost pairing protocol, credentials, origins, and storage configuration before deployment. iOS integration is deferred.

The Google Photos RPC formats are adapted from [Google Photos Toolkit](https://github.com/xob0t/Google-Photos-Toolkit), revision `6db9ab355e4797327e4078cf87a2b6994d36cf73`, under its MIT license. See `extension/THIRD_PARTY_NOTICES.md` and `extension/LICENSE-GPTK`.

Deleted review album recovery: the bridge checks for a replacement when a saved album cannot be read, clears stale local album acknowledgements, and preserves the queued selections. Live recovery created a new album and verified all 31 candidates. Reload the extension after updating its files to enable this recovery logic.

Video playback retains up to three preview buffers in browser memory through an authenticated localhost endpoint, allowing seeking even when Google returns a non-seekable playback URL. Both players loop automatically. The endpoint restricts requests to known videos and Google media hosts, rejects redirects and unexpected content, and caps previews at 512 MB. No Google cookies are sent to the backend, and video buffers are not written to disk.

Responsive UI verification in Chrome covered 320×568, 390×844, 430×932, and 844×390 layouts. Enlarged review controls use touch targets at least 44 px tall; mobile photo dragging and Undo were exercised with pointer gestures, and the removal queue was checked for horizontal overflow. This validates responsive layout and pointer behavior, not a physical iPhone or Safari session.

Review lookahead warms and decodes the current and next three previews in the selected filter/order. Small videos (up to 32 MB each) in the current-plus-two lookahead also buffer ahead, one background video download at a time. Requests are shared with foreground playback, buffers are evicted as the review advances, and enlarged review skips the compact card’s 230 ms animation wait. Large videos still load on demand.

## Loading unreviewed batches

Load 50 more scans past overlapping/already-reviewed pages until it adds at least 50 new review items, reaches the end, or hits the 12-page safety bound. Google pages can overlap, so a batch may add more than 50 items. The completion message counts new review items separately from library rows checked, and cursor loops/end-of-library are explicit. Decisions, sent queue status, generated exclusions and saved crop protection are preserved.

Refresh latest reads only the head page and does not rewind established older-library progress or clear its exhaustion flag. Bridge 1.3.1 supplies the import mode and expected cursor; stale concurrent imports are rejected before changing metadata or progress. Legacy bridges still support load-more scanning, but must be reloaded to use progress-preserving latest refresh.
