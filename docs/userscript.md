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

## Swiping, review and Trash

Photos Swipe fills most of the browser window on desktop, with the photo on the left and the counter, caption and buttons in a column beside it (smaller windows get a centered card), and opens as a full-screen sheet on phones. One card shows at a time with the next one behind it. Dragging lifts the whole card, with its frame, memory chip and buttons, off the deck and reveals the next card underneath. Swipe left (or ✕, or ←) to mark an item for Trash (nothing is deleted until you choose **Move N to Trash**) and right (or ♥, or →) to keep it; ↺ (or Z) undoes. The first card shows a short swipe hint. Enlarge (⤢ or F) goes fullscreen where the browser allows it (desktop, Android, iPad) and otherwise fills the screen; on iPhone a video opens in the native player. Fullscreen and the phone layout follow rotation, and a phone held sideways shows the photo beside the controls. Pinch a photo or video with two fingers to zoom in (up to 5×) on the card or in fullscreen, drag to pan it, and double-tap to fit it again; swiping pauses while it is zoomed. On a computer, scroll in fullscreen or pinch the trackpad to zoom. The buttons under ⤢ open the item in Google Photos in a new tab, to see what else is around it, and share the photo or video (or its Google Photos link when the browser cannot download it). A ring around Share fills as the file downloads. Close the share sheet and keep swiping: the download carries on and waits in the **Share tray**, Share turns blue with a count when it is ready, and opening Share lists the tray with **Send** for each ready item. Several shares download at once. Space plays and pauses videos. Videos start from a smaller Google transcode (360p on phones, 720p on desktop) and switch to a sharper version in place while playing.

The order button switches between **Flashbacks** (memories shuffled across your whole timeline, the default), **Timeline**, **Oldest first** and **Largest first**. The library loads in the background as you swipe. Kept photos come back occasionally (at most about one card in twenty, only after 30 days and 500 swipes, doubling each time you keep them again), labelled **Kept before**; turn this off in **Settings › Show**. When everything is reviewed the card says **All caught up** and offers **Refresh**.

The counter at the top shows the storage your marked items would free this session. Items Google stores for free, such as most photos backed up before June 2021, are labelled **stored free** in the caption and add nothing. Their card also carries a **Stored free · Trash frees no space** chip under the memory label (just **Trash frees no space** on screens under 380px), marking one briefly shows **Stored free** on the counter, and the status line says trashing it won’t free space. When **Move N to Trash** includes stored-free items, a sheet asks first: **Keep them** (or **Keep N, trash M** when others use storage) turns the stored-free items into Keeps, takes them out of Going to Trash and moves the rest, **Trash anyway** (or **Trash all N**) moves everything, and **Cancel** or Esc changes nothing. Marked items wait in a queue. The red trash badge shows how many; at 25 or more a pill above the buttons shows the count and the space they use. Open **Review** from the badge or the pill to see every marked item in a grid; long queues add tiles as you scroll. Tap a tile to preview it, tap ✓ to rescue it (it becomes a Keep), then **Move N to Trash**. A confirmation states the exact count. Items go to Google Photos Trash, where they stay restorable for 60 days. Each batch of 25 is verified in Trash before local state advances; if a later batch fails, the message says how many moved and how many are still queued. An item Google gave no Trash identifier for never holds up the rest: everything else moves, and that item stays marked and is named in the message. A **Done** screen shows the space freed, with **Keep swiping** and **Open Trash in Google Photos**. **Settings › Stats** shows the total freed. Swipes and Keep never move anything to Trash, and there is no permanent deletion.

Routine status messages fade after a few seconds; errors stay until you tap them. Hovering ↺ says what the next Undo restores; decisions and undo history (the last 2,000 decisions) survive reloads. **Settings › Stats** shows how many photos and videos you have reviewed, kept and marked for Trash, the storage freed (confirmed in Trash), what is still waiting in Going to Trash, reviews per day over the last 30 days (by your local calendar) and the running total of storage freed and marked. The stats are built when Settings opens. The freed line uses a local `trashedAt` time recorded when an item is confirmed in Trash; it is not synced, so items confirmed on another device fall back to the day they were marked. The demo adds about three weeks of made-up past decisions so its charts are not empty. **Settings › Refresh** has **Load 50 more**, **Refresh latest** and **Check deleted items** (reads Trash only; unknown results keep local state). A previously saved review-album transfer can still be finished from Settings; new album transfers are no longer offered.

Trash reconciliation confirms exact media identifiers directly. A dedup-key match with a different Trash identifier requires checking the library item's own state, so an older trashed copy cannot hide an active copy from review. **Settings › Library › Check Trash** also restores previously misclassified items when their individual state is confirmed active; unknown results retain their saved state.

The **In Trash** running total counter includes saved removal candidates confirmed in Trash across sessions in this browser and account. Reloading retains that estimate and resets action status messages. Restoring an open panel from the browser's page cache rereads local progress. The total can decrease when an item is confirmed active again; it is not Google's account storage meter.

## Local state and compatibility

Account-scoped decisions, imported metadata, pagination, undo history and album checkpoints live in the `photos-swipe-userscript` IndexedDB database on the Google Photos origin. Items are stored in 500-item chunks under `v2:<account>:<n>` with the rest of the state in `v2:<account>`, so a swipe rewrites only the chunk it changed; an older single-record library is migrated on the next save and the old record removed. The large Flashbacks order lists live in their own `resume-lists:<account>` record and are rewritten only when the order changes. Google authentication tokens and cookies are never stored by this script. No data is sent to the existing local app. **Sync settings** appears near the top and opens on first use. Choose **Sign in with Google** to sync, or **Continue locally** to dismiss setup; you can reopen settings anytime. The visible sync status reports success or a failure with local fallback. Optional Worker sync shares review decisions, counts and undo history between userscript devices; see [sync setup](sync.md). The desktop app remains separate. Clearing website data removes the local review cache, but manager-backed pairing survives. Avoid private browsing if you need durable local progress.

A renewable account lock prevents simultaneous work in multiple tabs. After a tab closes during an operation, a lock can take up to 90 seconds to expire. Account and page-session changes reject requests; close the overlay, reload Google Photos, and reopen it in the intended account.

This uses the same undocumented batchexecute RPC formats as the extension, with page fetch and the current Google session. With `unsafeWindow`, only the Google provider reads page globals and uses page fetch. Managers without `unsafeWindow`, including Userscripts, use an injected Google-operation bridge with bounded request timeouts. It reuses a page script nonce when available. The bridge carries Google operation names, arguments and results; it never receives pairing settings or exposes a sync API. Sync fetch runs in the privileged context with credentials omitted. Website CSP or future Google changes can prevent bridge execution; an unavailable bridge reports an error. If tokens are missing, sign in and reload.

Automated validation uses synthetic responses only. Physical iPhone/Safari execution and live Google responses have not been tested in this change. No real Google Photos requests were made during development.

## Pairing persistence and privacy

Only the Worker origin, device token, device ID and optional display name are saved in per-script GM storage. On first use with GM available, existing IndexedDB credentials are copied to GM before their old record is deleted. Local onboarding dismissal stays in IndexedDB. A failed GM write leaves the old credentials intact and reports the failure. Existing GM credentials take precedence over any stale IndexedDB credentials. Review data stays in IndexedDB and optional Worker sync.

The saved device token stays in the privileged script closure. Settings shows your sync account, **Switch account**, and **Sign out**. Signing out keeps local review progress. Existing token and paired devices keep syncing until Google sign-in links their progress; the new client has no token-entry or pairing flow.

If GM storage APIs are unavailable, settings use the original IndexedDB fallback and the settings panel shows **Pairing may not persist in this browser**. This fallback has the original page-storage privacy and eviction limits. GM failures do not silently downgrade durable credentials into page storage.

Reloads, version updates, Google Photos site-data clearing and Safari's origin-storage eviction do not erase manager storage. Reinstall retention depends on the manager and its removal options: keep the same script name/namespace and, for Userscripts, the same filename; avoid any **delete storage** option in Tampermonkey. If uninstalling the script or manager discards its storage, reinstalling cannot recover the token. Sign in with Google again; synced progress remains on the Worker.

### Manual QA matrix (pending)

No physical manager testing has been performed for this change. Run the following only on QA-DUMMY items in Chrome + Tampermonkey, macOS Safari + Userscripts, and iPhone Safari + Userscripts:

1. Install from the public install link, sign in with Google, and confirm **Synced**.
2. Reload, apply a version update, and confirm **Synced** after each step.
3. Uninstall/reinstall from the public link while retaining manager storage where supported; record the manager version and storage-removal choice. Confirm **Synced**, or document that the manager erased storage and sign in with Google again.
4. Clear site data for photos.google.com, reopen and confirm **Synced**. On iPhone, also repeat after more than seven days without visiting Photos.
5. Confirm library load, album creation/addition/verification, Trash reads and opt-in Move to Trash on QA-DUMMY items.
6. Inspect page-context globals, localStorage, IndexedDB : none should contain the saved device token with GM enabled. Test GM-disabled fallback separately and confirm the persistence notice.

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

The installable userscript is a small loader. On each page load it asks the Worker's `/version` for the live release (3 s limit). If GM storage already holds that release, it runs immediately without downloading; otherwise it downloads `/app.js` (30 s limit), saves it in GM storage and runs it. If the Worker is unreachable, the cached release runs without a banner. Opening **Photos Swipe** checks `/version` again, so a Google Photos tab left open for days still updates: if a newer release exists and you haven't swiped since opening, the overlay closes, Google Photos reloads into the new release and Photos Swipe reopens. Each release triggers at most one automatic reload per tab; after a swipe it only shows that an update is available. Execution uses Trusted Types when available, with an inline script fallback if eval is blocked. A blue “Update available” link appears only when nothing can run or the loader itself is older than the Worker requires; tap it to reinstall. Desktop Tampermonkey uses the same loader. Existing full-bundle installations, and loaders older than 1.2.76, need one manual reinstall from the install link to get this behavior.

The build also produces `userscript/photoswiper-app.user.js`, the full app artifact used by regression tests and stripped of its metadata when served at `/app.js`. The separate signed test loader continues to use signed releases. Real iPhone verification of content-world execution and offline recovery remains necessary.
