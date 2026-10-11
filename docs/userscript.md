# Standalone userscript

Photos Swipe can run directly in your signed-in Google Photos tab, without Node, a server, the Chrome bridge or pairing. The single installable file is [photoswiper.user.js](https://raw.githubusercontent.com/sidlakkoju/GooglePhotosSwiper/main/userscript/photoswiper.user.js).

## Desktop: Tampermonkey or Violentmonkey

1. Enable Tampermonkey or Violentmonkey in your browser and allow it to run on `photos.google.com`. Follow your manager's browser setup instructions if script execution is disabled.
2. Open the install link above, review the script, and choose Install in your manager. If the link displays source instead, create a new script in the manager, replace its contents with the downloaded file, and save.
3. Open or reload `https://photos.google.com/`, sign into the intended account, and select **Photos Swipe** at the bottom right.
4. Confirm the account shown in the overlay, then choose **Load 50 more**.

## iPhone/iPad: quoid's Userscripts for Safari

1. Install [Userscripts](https://github.com/quoid/userscripts), open the app, and check its scripts directory. Choose a directory if your version asks for one.
2. Enable Userscripts in Safari's extension settings and allow it on `photos.google.com`. Depending on iOS, these settings are under Settings → Apps → Safari → Extensions, or Settings → Safari → Extensions.
3. Open the install link in Safari. Open Safari's extensions menu, select Userscripts, and accept its installation prompt. Alternatively, save the downloaded file as `photoswiper.user.js` in the app's selected scripts directory. Open the Userscripts popup so it discovers the file and ensure it is enabled.
4. Open Google Photos **in Safari**, sign in, reload, and tap the **Photos Swipe** launcher. Review the account label before loading media. This runs in the website, not the Google Photos native app.

The two installation methods and page-context metadata follow the [Userscripts documentation](https://github.com/quoid/userscripts#ios-ipados). Keep `@grant none` and `@inject-into page`: the script needs access to Google's page session tokens. No userscript-manager APIs are used.

## Review and album workflow

The media card appears above the stats on mobile. Phone layouts keep Zoom on one row, pair the filter and sort controls, and keep album and opt-in Trash controls in a sticky bottom action area. Swipe a photo horizontally or use **Queue** and **Keep**. For videos, use the separate swipe strip below the player so native playback and scrubbing controls stay usable. Photos support Enlarge, the Zoom slider, and browser pinch zoom. On desktop, left/right arrows queue/keep, Z undoes, F enlarges, Space toggles video playback, and Escape closes the overlay.

Open **Removal queue** and select a thumbnail to inspect it. **Keep instead** changes its decision; **Back to review** returns to the deck. Decisions and undo history survive reloads in IndexedDB. Undo names the restored item and shows it on the card, even when it was off-screen or the review order has changed. If Undo restores a removal decision, the card opens that item for queue inspection.

**Load 50 more** scans through overlapping or reviewed pages until it finds 50 new review items, reaches the end, or checks 12 pages. **Refresh latest** reads the head page while retaining older-library progress. Filters and order apply to the current local batch.

**Send to review album** asks for confirmation, creates or finds a private album named **Photos Swipe · Review**, adds candidates in batches of 25, and verifies membership. The entire saved batch stays in the queue until every item is verified. Failed or interrupted operations can be resumed with **Retry saved album operation**, including after reloading. Candidates in that saved operation cannot be changed until it finishes. Existing album links and saved operations retain their original targets, including albums created with the older hash suffix. Previously added items are checked before retrying additions.

To move reviewed candidates to Trash, select **Enable Move to Trash**, review the **Move to Trash candidates** list, and explicitly confirm the listed items. The list and button count include queued and previously sent removal candidates, with thumbnails, names, dates, status and media IDs. Select a thumbnail to inspect the item or choose **Keep instead** to exclude it. The confirmation repeats the exact names and IDs. Each batch is verified in Trash before local state advances. Keep and swipes never move media to Trash. You can also use Google Photos to move items manually. **Check deleted items** only reads Trash and item state. Unknown results preserve existing local state. The userscript has no permanent deletion operation. Queue and confirmed-Trash estimates use quota bytes when known, count known free items as zero, and flag unknown sizes.

Trash reconciliation confirms exact media identifiers directly. A dedup-key match with a different Trash identifier requires checking the library item's own state, so an older trashed copy cannot hide an active copy from review. Check deleted items also restores previously misclassified items when their individual state is confirmed active; unknown results retain their saved state.

The **In Trash · running total · estimated savings** counter includes saved removal candidates confirmed in Trash across sessions in this browser and account. Reloading retains that estimate and resets action status messages. Restoring an open panel from the browser's page cache rereads local progress. The total can decrease when an item is confirmed active again; it is not Google's account storage meter.

## Local state and compatibility

Account-scoped decisions, imported metadata, pagination, undo history and album checkpoints live in the `photos-swipe-userscript` IndexedDB database on the Google Photos origin. Tokens and Google cookies are never stored by this script. No data is sent to the existing local app. State does not sync between devices, Safari profiles, userscript managers or the desktop app. Clearing website data removes it. Avoid private browsing if you need durable progress.

A renewable account lock prevents simultaneous work in multiple tabs. After a tab closes during an operation, a lock can take up to 90 seconds to expire. Account and page-session changes reject requests; close the overlay, reload Google Photos, and reopen it in the intended account.

This uses the same undocumented batchexecute RPC formats as the extension, with in-page fetch and the current Google session. It reads page tokens, not Google Photos' DOM structure. If tokens are missing, check that the manager runs this script in the page context, that you are signed in, and reload. Website CSP or future Google changes can prevent execution; changing to content-context injection cannot provide the required page globals.

Automated validation uses synthetic responses only. Physical iPhone/Safari execution and live Google responses have not been tested in this change. No real Google Photos requests were made during development.

## Build and test

From the repository root:

```sh
node scripts/build-userscript.mjs
node scripts/build-userscript.mjs --check
npm test
node scripts/check.mjs
```

The dependency-free build bundles `extension/photos-api.js` and `lib/userscript-*.mjs` into the installable file. The bundle uses ASCII Unicode escapes so labels retain their symbols even when an install endpoint omits a UTF-8 charset. Include that generated file whenever distributing changes, and increase the metadata version in the build script for a release. Unit tests cover request envelopes, fake responses, pagination, decisions, quota estimates, partial album retries and read-only Trash reconciliation. The artifact test checks metadata, absence of privileged APIs and reproducibility.

RPC mappings are adapted from Google Photos Toolkit by xob0t, revision `6db9ab355e4797327e4078cf87a2b6994d36cf73`. The upstream MIT license is retained in [the license notice](../extension/LICENSE-GPTK), with [third-party attribution](../extension/THIRD_PARTY_NOTICES.md).
