# Standalone userscript

Photos Swipe can run directly in your signed-in Google Photos tab, without Node, a server, the Chrome bridge or pairing. The single installable file is [photos-swipe.user.js](https://raw.githubusercontent.com/sidlakkoju/GooglePhotosSwiper/main/userscript/photos-swipe.user.js).

## Desktop: Tampermonkey or Violentmonkey

1. Enable Tampermonkey or Violentmonkey in your browser and allow it to run on `photos.google.com`. Follow your manager's browser setup instructions if script execution is disabled.
2. Open the install link above, review the script, and choose Install in your manager. If the link displays source instead, create a new script in the manager, replace its contents with the downloaded file, and save.
3. Open or reload `https://photos.google.com/`, sign into the intended account, and select **Photos Swipe** at the bottom right.
4. Confirm the account shown in the overlay, then choose **Load 50 more**.

## iPhone/iPad: quoid's Userscripts for Safari

1. Install [Userscripts](https://github.com/quoid/userscripts), open the app, and check its scripts directory. Choose a directory if your version asks for one.
2. Enable Userscripts in Safari's extension settings and allow it on `photos.google.com`. Depending on iOS, these settings are under Settings → Apps → Safari → Extensions, or Settings → Safari → Extensions.
3. Open the install link in Safari. Open Safari's extensions menu, select Userscripts, and accept its installation prompt. Alternatively, save the downloaded file as `photos-swipe.user.js` in the app's selected scripts directory. Open the Userscripts popup so it discovers the file and ensure it is enabled.
4. Open Google Photos **in Safari**, sign in, reload, and tap the **Photos Swipe** launcher. Review the account label before loading media. This runs in the website, not the Google Photos native app.

The two installation methods and page-context metadata follow the [Userscripts documentation](https://github.com/quoid/userscripts#ios-ipados). Keep `@grant none` and `@inject-into page`: the script needs access to Google's page session tokens. No userscript-manager APIs are used.

## Review and album workflow

The media card appears above the stats on mobile. Swipe a photo horizontally or use **Queue** and **Keep**. For videos, use the separate swipe strip below the player so native playback and scrubbing controls stay usable. Photos support Enlarge, the Zoom slider, and browser pinch zoom. On desktop, left/right arrows queue/keep, Z undoes, F enlarges, Space toggles video playback, and Escape closes the overlay.

Open **Removal queue** and select a thumbnail to inspect it. **Keep instead** changes its decision; **Back to review** returns to the deck. Undo history lasts for this page session. Decisions survive reloads.

**Load 50 more** scans through overlapping or reviewed pages until it finds 50 new review items, reaches the end, or checks 12 pages. **Refresh latest** reads the head page while retaining older-library progress. Filters and order apply to the current local batch.

**Send to review album** asks for confirmation, creates or finds a private review album, adds candidates in batches of 25, and verifies membership. The entire saved batch stays in the queue until every item is verified. Failed or interrupted operations can be resumed with **Retry saved album operation**, including after reloading. Candidates in that saved operation cannot be changed until it finishes. Previously added items are checked before retrying additions.

Open the album in Google Photos, select the intended items, and use Google's **Move to trash** command yourself. **Check deleted items** only reads Trash and item state. Unknown results preserve existing local state. The userscript has no Trash mutation or permanent deletion operation. Queue and confirmed-Trash estimates use quota bytes when known, count known free items as zero, and flag unknown sizes.

## Local state and compatibility

Account-scoped decisions, imported metadata, pagination and album checkpoints live in the `photos-swipe-userscript` IndexedDB database on the Google Photos origin. Tokens and Google cookies are never stored by this script. No data is sent to the existing local app. State does not sync between devices, Safari profiles, userscript managers or the desktop app. Clearing website data removes it. Avoid private browsing if you need durable progress.

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

The dependency-free build bundles `lib/userscript-*.mjs` into the installable file. Include that generated file whenever distributing changes, and increase the metadata version in the build script for a release. Unit tests cover request envelopes, fake responses, pagination, decisions, quota estimates, partial album retries and read-only Trash reconciliation. The artifact test checks metadata, absence of privileged APIs and reproducibility.

RPC mappings are adapted from Google Photos Toolkit by xob0t, revision `6db9ab355e4797327e4078cf87a2b6994d36cf73`. The generated metadata header includes the upstream MIT license; see also [the existing attribution](../extension/THIRD_PARTY_NOTICES.md).
