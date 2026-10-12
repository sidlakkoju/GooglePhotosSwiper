# Standalone userscript

Photos Swipe can run directly in your signed-in Google Photos tab, without Node, a server, the Chrome bridge or pairing. The single installable file is [photoswiper.user.js](https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js).

## Desktop: Tampermonkey or Violentmonkey

1. Enable Tampermonkey or Violentmonkey in your browser and allow it to run on `photos.google.com`. For Tampermonkey in Chrome, open `chrome://extensions`, select Tampermonkey **Details**, and turn on **Allow User Scripts** (off by default). If Chrome requires Developer mode to expose this toggle, enable it on the extensions page first. Follow your manager's browser setup instructions if script execution is disabled.
2. Open the install link above, review the script, and choose Install in your manager. If the link displays source instead, create a new script in the manager, replace its contents with the downloaded file, and save.
3. Open or reload `https://photos.google.com/`, sign into the intended account, and select **Photos Swipe** at the bottom right.
4. Confirm the account shown in the overlay, then choose **Load 50 more**.

## iPhone/iPad: quoid's Userscripts for Safari

1. Install [Userscripts](https://github.com/quoid/userscripts), open the app, and check its scripts directory. Choose a directory if your version asks for one.
2. Enable Userscripts in Safari's extension settings and allow it on `photos.google.com`. Depending on iOS, these settings are under Settings → Apps → Safari → Extensions, or Settings → Safari → Extensions.
3. Open the install link in Safari. Open Safari's extensions menu, select Userscripts, and accept its installation prompt. Alternatively, save the downloaded file as `photoswiper.user.js` in the app's selected scripts directory. Open the Userscripts popup so it discovers the file and ensure it is enabled.
4. Open Google Photos **in Safari**, sign in, reload, and tap the **Photos Swipe** launcher. Review the account label before loading media. This runs in the website, not the Google Photos native app.

The script requests `GM.getValue`, `GM.setValue`, `GM.deleteValue` and `unsafeWindow`, and uses `@inject-into content`. [Userscripts requires content injection for GM APIs](https://github.com/quoid/userscripts#api). Keep these grants when updating or installing: pairing credentials belong in the manager's private storage.

## Review and album workflow

The media card appears above the stats on mobile. Phone layouts keep Zoom on one row, pair the filter and sort controls, and keep album and opt-in Trash controls in an action area below the library controls. Swipe a photo horizontally or use **Queue** and **Keep**. For videos, use the separate swipe strip below the player so native playback and scrubbing controls stay usable. Photos support Enlarge, the Zoom slider, and browser pinch zoom. On desktop, left/right arrows queue/keep, Z undoes, F enlarges, Space toggles video playback, and Escape closes the overlay.

Open **Removal queue** and select a thumbnail to inspect it. **Keep instead** changes its decision; **Back to review** returns to the deck. Open **Decision history** to see recent decisions, their previous values, and the exact item and value the next **Undo** will restore. Entries that cannot currently be undone are marked unavailable. Decisions and undo history survive reloads in IndexedDB. Undo names the restored item and shows it on the card, even when it was off-screen or the review order has changed. If Undo restores a removal decision, the card opens that item for queue inspection.

**Load 50 more** scans through overlapping or reviewed pages until it finds 50 new review items, reaches the end, or checks 12 pages. **Refresh latest** reads the head page while retaining older-library progress. Filters and order apply to the current local batch.

**Send to review album** asks for confirmation, creates or finds a private album named **Photos Swipe · Review**, adds candidates in batches of 25, and verifies membership. The entire saved batch stays in the queue until every item is verified. Failed or interrupted operations can be resumed with **Retry saved album operation**, including after reloading. Candidates in that saved operation cannot be changed until it finishes. Existing album links and saved operations retain their original targets, including albums created with the older hash suffix. Unreadable saved albums stay saved for retry; a failed read never redirects candidates into another album. Previously added items are checked before retrying additions.

To move reviewed candidates to Trash, select **Enable Move to Trash**, review the **Move to Trash candidates** list, and explicitly confirm the listed items. The list and button count include queued and previously sent removal candidates, with thumbnails, names, dates, status and media IDs. Select a thumbnail to inspect the item or choose **Keep instead** to exclude it. The confirmation repeats the exact names and IDs. Each batch is verified in Trash before local state advances. Keep and swipes never move media to Trash. You can also use Google Photos to move items manually. **Check deleted items** only reads Trash and item state. Unknown results preserve existing local state. The userscript has no permanent deletion operation. Queue and confirmed-Trash estimates use quota bytes when known, count known free items as zero, and flag unknown sizes.

Trash reconciliation confirms exact media identifiers directly. A dedup-key match with a different Trash identifier requires checking the library item's own state, so an older trashed copy cannot hide an active copy from review. Check deleted items also restores previously misclassified items when their individual state is confirmed active; unknown results retain their saved state.

The **In Trash** running total counter includes saved removal candidates confirmed in Trash across sessions in this browser and account. Reloading retains that estimate and resets action status messages. Restoring an open panel from the browser's page cache rereads local progress. The total can decrease when an item is confirmed active again; it is not Google's account storage meter.

## Local state and compatibility

Account-scoped decisions, imported metadata, pagination, undo history and album checkpoints live in the `photos-swipe-userscript` IndexedDB database on the Google Photos origin. Google authentication tokens and cookies are never stored by this script. No data is sent to the existing local app. **Sync settings** appears near the top and opens on first use. Choose **Save and sync** with your Worker URL and token, or **Continue locally** to dismiss setup; you can reopen settings anytime. The visible sync status reports success or a failure with local fallback. Optional Worker sync shares review decisions, counts and undo history between userscript devices; see [sync setup](sync.md). The desktop app remains separate. Clearing website data removes the local review cache, but manager-backed pairing survives. Avoid private browsing if you need durable local progress.

A renewable account lock prevents simultaneous work in multiple tabs. After a tab closes during an operation, a lock can take up to 90 seconds to expire. Account and page-session changes reject requests; close the overlay, reload Google Photos, and reopen it in the intended account.

This uses the same undocumented batchexecute RPC formats as the extension, with page fetch and the current Google session. With `unsafeWindow`, only the Google provider reads page globals and uses page fetch. Managers without `unsafeWindow`, including Userscripts, use an injected Google-operation bridge with bounded request timeouts. It reuses a page script nonce when available. The bridge carries Google operation names, arguments and results; it never receives pairing settings or exposes a sync API. Sync fetch runs in the privileged context with credentials omitted. Website CSP or future Google changes can prevent bridge execution; an unavailable bridge reports an error. If tokens are missing, sign in and reload.

Automated validation uses synthetic responses only. Physical iPhone/Safari execution and live Google responses have not been tested in this change. No real Google Photos requests were made during development.

## Pairing persistence and privacy

Only the Worker origin, device token, device ID and optional display name are saved in per-script GM storage. On first use with GM available, existing IndexedDB credentials are copied to GM before their old record is deleted. Local onboarding dismissal stays in IndexedDB. A failed GM write leaves the old credentials intact and reports the failure. Existing GM credentials take precedence over any stale IndexedDB credentials. Review data stays in IndexedDB and optional Worker sync.

The saved token is held inside the privileged script closure. It is never filled into the settings form or published to page globals, localStorage or the Google bridge. Enter a token to pair or replace it; leaving the token field blank keeps the existing token when the Worker URL is unchanged. Clear both URL and token and save to disable sync and delete the GM pairing. A token being entered in the form can be observed by page scripts; saved credentials are cleared from the form before saving and syncing.

If GM storage APIs are unavailable, settings use the original IndexedDB fallback and the settings panel shows **Pairing may not persist in this browser**. This fallback has the original page-storage privacy and eviction limits. GM failures do not silently downgrade durable credentials into page storage.

Reloads, version updates, Google Photos site-data clearing and Safari's origin-storage eviction do not erase manager storage. Reinstall retention depends on the manager and its removal options: keep the same script name/namespace and, for Userscripts, the same filename; avoid any **delete storage** option in Tampermonkey. If uninstalling the script or manager discards its storage, reinstalling cannot recover the token. Re-pair once; synced progress remains on the Worker.

### Manual QA matrix (pending)

No physical manager testing has been performed for this change. Run the following only on QA-DUMMY items in Chrome + Tampermonkey, macOS Safari + Userscripts, and iPhone Safari + Userscripts:

1. Install from the public install link, pair, and confirm **Synced**.
2. Reload, apply a version update, and confirm **Synced** after each step.
3. Uninstall/reinstall from the public link while retaining manager storage where supported; record the manager version and storage-removal choice. Confirm **Synced**, or document that the manager erased storage and re-pair.
4. Clear site data for photos.google.com, reopen and confirm **Synced**. On iPhone, also repeat after more than seven days without visiting Photos.
5. Confirm library load, album creation/addition/verification, Trash reads and opt-in Move to Trash on QA-DUMMY items.
6. Inspect page-context globals, localStorage, IndexedDB and the saved token field: none should contain the saved device token with GM enabled. Test GM-disabled fallback separately and confirm the persistence notice.

## Build and test

From the repository root:

```sh
node scripts/build-userscript.mjs
node scripts/build-userscript.mjs --check
npm test
node scripts/check.mjs
```

The dependency-free build bundles `extension/photos-api.js` and `lib/userscript-*.mjs` into the installable file. The bundle uses ASCII Unicode escapes so labels retain their symbols even when an install endpoint omits a UTF-8 charset. Include that generated file whenever distributing changes, and increase the metadata version in the build script for a release. Unit tests cover request envelopes, fake responses, pagination, decisions, quota estimates, partial album retries and read-only Trash reconciliation. The artifact test checks privileged grants, credential isolation and reproducibility. Synthetic tests cover GM storage, migration, fallback, independent sync fetch and the content-to-page Google bridge.

RPC mappings are adapted from Google Photos Toolkit by xob0t, revision `6db9ab355e4797327e4078cf87a2b6994d36cf73`. The upstream MIT license is retained in [the license notice](../extension/LICENSE-GPTK), with [third-party attribution](../extension/THIRD_PARTY_NOTICES.md).

The installable userscript is a small loader. Each page load requests the current app from the Worker’s `/app.js` through the userscript manager and saves it in GM storage for offline use. Execution uses Trusted Types when available, with an inline script fallback if eval is blocked. The Worker exposes the app version through `X-Photoswiper-Version` and `/version`. A blue “Update available” link appears when the installed loader version is older than the live version; tap it to open the installation URL. Desktop Tampermonkey uses the same loader. Existing full-bundle installations need one manual update to receive the loader.

The build also produces `userscript/photoswiper-app.user.js`, the full app artifact used by regression tests and stripped of its metadata when served at `/app.js`. The separate signed test loader continues to use signed releases. Real iPhone verification of content-world execution and offline recovery remains necessary.
