# Photos Swipe

A local desktop app for reviewing Google Photos one photo or video at a time. Swipe right to keep an item; swipe left to add it to a removal queue. Send the queue to a private Google Photos review album, then delete the items yourself in Google Photos.

**Swiping and creating an album never delete photos.** The core app has no Trash or permanent-deletion command.

## Standalone userscript (desktop and iOS Safari)

[Install Photos Swipe](https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js) in Tampermonkey, Violentmonkey, or quoid's iOS **Userscripts** Safari extension. Open Google Photos in the browser, then tap the **Photos Swipe** launcher. This version runs inside your signed-in Photos page, with account-scoped decisions and progress saved in IndexedDB; no server or pairing is needed.

See [userscript installation and usage](docs/userscript.md). The review card sits above the stats on mobile, with touch swipes and desktop keyboard controls. Album writes are verified. Move to Trash is opt-in and requires confirmation of the exact count; undo history survives reloads. State is separate from the desktop app and does not sync across devices. Physical iPhone/Safari validation remains outstanding.

For the experimental signed loader, use [the separate test install link](https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js). On iPhone, first remove the old full Photos Swipe script from **Userscripts**, then open this link in Safari and save it in Userscripts. Enable the extension and allow it on photos.google.com in Safari settings, then open Google Photos in Safari. The loader fetches and verifies a signed release on each page load and uses its verified cached release when offline. The first load needs a network connection. Physical iPhone validation of this loader remains outstanding.

## Publishing the userscript

Every merge to `main` should be followed by `./scripts/deploy-worker.sh` to republish the userscript. The script rebuilds both artifacts and signs the app using the Ed25519 PKCS8 PEM at `PHOTOSWIPER_SIGNING_KEY` (default `~/.photoswiper/photoswiper-signing.key`, then `/home/box/shared/photoswiper-signing.key`), then runs `npx --yes wrangler@4 deploy` from `worker/`. It uses existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables, or sources `~/.photoswiper/cloudflare.env` (falling back to `/home/box/shared/cloudflare.env`) when they are not both set. Keep credentials and the private signing key outside the repository and never commit secrets. Signing fails before deployment if the key is missing or does not match the loader’s pinned public key. The generated release module in `worker/generated/` is ignored by Git; local tests use synthetic releases and ephemeral keys.

The `photoswiper-sync` Worker bundles the script at deployment time using a [Wrangler Text module rule](https://developers.cloudflare.com/workers/wrangler/bundling/). It serves public GET and HEAD requests at `/photoswiper.user.js` with a five-minute cache lifetime; unknown paths return 404.

## Quick start

Requirements: Node.js **22.13 or newer**, Chrome, and a Google Photos account. There are no npm dependencies to install and no hosted backend.

```sh
git clone git@github.com:sidlakkoju/GooglePhotosSwiper.git
cd GooglePhotosSwiper
npm start
```

1. Open `http://localhost:3000/` in Chrome. Sign in using the local access code in `.data/access-code`, or open the access link saved in `.data/local-login-url`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repository's `extension/` directory. Reload the app tab.
3. Open Google Photos in a second Chrome tab, signed into your intended account.
4. In the app, choose **Google Photos → Generate pairing code**. While the Photos tab is active, open the extension popup and enter that code.
5. Return to the app, choose **Check connection**, close the connection dialog, and select **Load 50 more**.

Use exactly `http://localhost:3000/`: the desktop bridge is configured for this origin and port. The Codex in-app browser can display the page but cannot use the Chrome extension. Leave the Google Photos tab open while reviewing.

See the [setup and troubleshooting guide](docs/setup.md), or open the human-readable [in-app guide](public/guide.html) at `http://localhost:3000/guide.html` after starting the server.

## Reviewing photos and videos

| Control | Result |
| --- | --- |
| Swipe right, right arrow, or ✓ | Keep the item and advance |
| Swipe left, left arrow, or × | Queue the item for removal and advance |
| Z or Undo | Undo one of the last 100 swipes in this tab, including after reload |
| F, double-click a photo, or enlarge button | Open the enlarged viewer |
| F or Escape in the viewer | Close the enlarged viewer |
| Space on a video | Play or pause |
| Scroll/pinch, +/−, Fit | Zoom, pan, or reset a photo |

Videos autoplay muted and loop in the regular view. Use the volume control for sound. Enlarged review supports arrow decisions and Undo without closing; photos swipe at fit zoom, while zoomed dragging pans. Videos have a separate swipe area so native scrubbing remains usable. Queue thumbnails open the same photo/video viewer for inspection.

**Load 50 more** scans past overlapping and already-reviewed pages until it finds at least 50 new review items, reaches the end, or hits a 12-page safety bound. A batch can contain more than 50 new items. Messages distinguish new review items from library rows checked. **Refresh latest** updates the head of the library without rewinding older-library progress; this requires bridge 1.3.1 or newer.

## Removal queue and storage estimates

- **Queue · estimated savings** counts only the current removal queue. It changes with swipes, Keep instead and Undo. An empty queue shows **0 KB**.
- **Sent to album · awaiting Trash** counts fully verified sent items that have not been confirmed in Trash. They stay reviewed and are no longer queued, even if an album later becomes unavailable.
- **In Trash · estimated savings** counts removal candidates confirmed in Google Photos Trash through **Check deleted items**.

Known quota bytes take precedence over file size. Known non-quota media count as zero, and unknown sizes are marked. These are estimates, not a reading of Google's account storage meter.

Choose **Send to review album** and confirm the count. Only a fully verified album update clears that batch from the queue; decisions remain saved, so sent items do not reappear after a restart or reimport. Partial/failed updates retain their candidates and checkpoints for retry. During an interrupted update, **Keep instead** does not remove a previously added item from the Google album.

To delete, open the review album in Google Photos, select the items, then choose **More options → Move to trash**. Removing items from an album or deleting the album does not delete the underlying library items. Afterwards, use **Check deleted items** in this app. This performs reads only; unknown results leave local state unchanged.

## Project layout

| Path | Purpose |
| --- | --- |
| `public/` | Review UI, media viewer, preview cache, import controller, browser guide |
| `server.mjs` | Loopback-only server, local authentication, application/bridge endpoints |
| `lib/store.mjs` | SQLite persistence, revisions, account binding, album jobs, reconciliation |
| `worker/` | Cloudflare Worker serving the bundled userscript publicly |
| `userscript/` | Built standalone userscript for Google Photos in desktop browsers and iOS Safari |
| `extension/` | Chrome Manifest V3 bridge and Google Photos web API adapter |
| `test/` | Core regression tests and synthetic browser fixtures |
| `docs/` | Setup, architecture, development, privacy, status and future plans |
| `diagrams/` | Earlier design diagrams; architecture docs describe the current core app |
| `.data/` | Private runtime database and credentials; excluded from Git |

Read the [project context](PROJECT_CONTEXT.md), [architecture](docs/architecture.md), [development and testing](docs/development.md), and [privacy and local data](docs/privacy.md).

## Branches and current scope

| Branch | Status |
| --- | --- |
| `main` | Current core desktop app: review, playback, queue, albums, storage estimates and reconciliation |
| `codex/core-review` | Preserved initial core-isolation checkpoint; later fixes are on `main` |
| `codex/video-cropping` | Experimental cropping implementation and research; not part of the active core app |

Cropping is not reliable enough for the main experience. The feature branch preserves the editor, macOS exporter, upload providers and recovery jobs. Existing private crop data and generated-copy exclusions remain intact; originals attached to unfinished crop jobs are protected from ordinary review/album sending in core.

No website integration, cloud deployment or iPhone connection is deployed. See the [roadmap](docs/roadmap.md) and [local personal-site integration plan](docs/personal-site-integration.md).

## Validation

```sh
npm test
npm run check
```

The core suite currently has **48 passing tests**. Tests cover authentication/pairing, persistence, revisions, pagination and overlapping pages, partial album writes/retries, queue clearance, storage accounting and provider response handling. Synthetic browser fixtures cover the UI without using personal media or sending requests to Google. Live desktop and responsive browser checks are recorded in [implementation status](docs/core-review-status.md); physical iPhone/Safari behavior remains unverified.

Google Photos access uses an **undocumented web API** and can require maintenance when Google changes it. The RPC formats are adapted from [Google Photos Toolkit](https://github.com/xob0t/Google-Photos-Toolkit), revision `6db9ab355e4797327e4078cf87a2b6994d36cf73`. Its MIT attribution is retained in [third-party notices](extension/THIRD_PARTY_NOTICES.md) and [license notice](extension/LICENSE-GPTK).

Optional userscript sync: [Worker and device setup](docs/sync.md). Sync stores only item IDs, decisions, progress and undo history in D1.
