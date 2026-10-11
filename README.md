# Photos Swipe

A local desktop app for reviewing Google Photos one photo or video at a time. Swipe right to keep an item; swipe left to add it to a removal queue. Send the queue to a private Google Photos review album, then delete the items yourself in Google Photos.

**Swiping and creating an album never delete photos.** The core app has no Trash or permanent-deletion command.

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
| Z or Undo | Undo the last decision made in this tab |
| F, double-click a photo, or enlarge button | Open the enlarged viewer |
| F or Escape in the viewer | Close the enlarged viewer |
| Space on a video | Play or pause |
| Scroll/pinch, +/−, Fit | Zoom, pan, or reset a photo |

Videos autoplay muted and loop in the regular view. Use the volume control for sound. Enlarged review supports arrow decisions and Undo without closing; photos swipe at fit zoom, while zoomed dragging pans. Videos have a separate swipe area so native scrubbing remains usable. Queue thumbnails open the same photo/video viewer for inspection.

**Load 50 more** scans past overlapping and already-reviewed pages until it finds at least 50 new review items, reaches the end, or hits a 12-page safety bound. A batch can contain more than 50 new items. Messages distinguish new review items from library rows checked. **Refresh latest** updates the head of the library without rewinding older-library progress; this requires bridge 1.3.1 or newer.

## Removal queue and storage estimates

- **Queue · estimated savings** counts only the current removal queue. It changes with swipes, Keep instead and Undo. An empty queue shows **0 KB**.
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
