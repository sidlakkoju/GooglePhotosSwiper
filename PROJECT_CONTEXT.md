# Photos Swipe — context for another agent

## What we are trying to accomplish

Build a simple way to clean up a personal Google Photos library and recover storage. The main experience is like Tinder for photos and videos: show one item at a time, swipe right to keep it, and swipe left to mark it for removal. The user wants to make quick decisions without selecting hundreds of small thumbnails or hunting down filenames afterwards.

The long-term goal includes both desktop and iPhone. The user specifically does not want their Mac to have to be running whenever they want to swipe on their phone.

## The core requirements

- Review real photos and videos from the user's Google Photos library.
- Keep with a right swipe; put an item in the removal queue with a left swipe.
- Undo mistakes, inspect queued items, and change a removal decision to keep.
- Enlarge and zoom photos; play, pause, scrub, and inspect videos.
- Load more library items without repeatedly showing previously reviewed items. Refresh recent media without losing progress through older media.
- Save decisions and progress across refreshes, restarts, and imports.
- Show how much storage the removal queue might recover. Distinguish known storage usage from unknown values or files that do not count against Google's quota.
- Apply removal decisions to the correct Google account and report what actually succeeded. Failed or partially completed operations must remain available to retry.
- Provide a useful mobile experience, ultimately without an always-on personal computer.

## How removing photos currently works

A left swipe adds an item to the app's removal queue. It does not delete the photo.

The user reviews the queue and chooses to send it to a private Google Photos review album. The app adds those existing library items to the album and verifies that they arrived. Only a fully verified batch leaves the working queue; the original decisions stay saved.

The user then opens that album in Google Photos, selects its contents, and moves them to Trash. Deleting the album or removing photos from the album would not delete the underlying photos.

The app can subsequently check which candidates are confirmed in Trash and update its records and estimates. An inconclusive check must not discard an item or claim that it was deleted.

The active core app has no command to move photos to Trash or permanently delete them. Direct deletion was discussed as a possible future feature, not implemented as the current workflow.

## Why connecting to Google Photos is unusual

Google's official APIs do not support managing arbitrary existing library items in the way this project needs. The Picker API provides access to user-selected media, while official album editing is restricted to app-created media. Our first prototype used the Picker, but that did not solve the practical cleanup workflow.

The current integration instead adapts the undocumented Google Photos website API from Google Photos Toolkit:
https://github.com/xob0t/Google-Photos-Toolkit

This lets a bridge running inside a signed-in Google Photos page read library items, retrieve metadata, and add existing items to albums. It relies on the user's browser session and can require maintenance when Google changes its website. The upstream MIT license attribution is retained.

Simply signing into Google Photos in one tab does not authorize our separate app tab or backend to use that session. Google Photos tabs can share their Google login, but our app lives on a different website origin. An explicit bridge is needed. Private-API identifiers must also not be confused with official Picker identifiers.

## What exists today

The repository now contains a local desktop app, not just the original demo:

- A browser-based review interface, enlarged media viewer, preview cache, and persistent removal queue.
- A local Node server and private SQLite database.
- A Chrome extension that connects the app to a signed-in Google Photos tab.
- Account pairing, library loading, album updates with verification and retry checkpoints, and read-only checks of deletion status.
- Storage estimates for the active removal queue and separately for confirmed Trash candidates.

The current workflow runs at http://localhost:3000 in Chrome. The user loads the extension, pairs it with the app, and keeps the Google Photos tab open. It has no hosted backend. Responsive layouts have been checked, but that does not mean the Google connection works on a physical iPhone.

## iPhone and hosting: proposed, not proven

The proposed future design separates reviewing from applying changes:

1. Import a batch of media identifiers, metadata, and cached previews into a private hosted app.
2. Swipe on the iPhone or desktop whenever convenient. Store decisions in the hosted backend so the Mac is not needed for reviewing a cached batch.
3. When ready, use an active Google Photos browser session to apply the queue to a review album and report results back to the app.

For iPhone, we discussed an Apple Shortcut installed through an iCloud link and launched from Safari's Share menu while Google Photos is open. It could run JavaScript on that page to import a batch or apply decisions. This has not been validated against Google Photos on iPhone. Access to page session data, private API calls, execution limits, and media transfer still need a proof of concept.

For desktop, the Chrome bridge already provides the relevant pattern. The hosted backend would use its own app authentication; Google cookies and page authentication tokens would stay in the Google Photos browser context.

Hosting, media retention, costs, shared-device/account boundaries, and full video access on mobile are unresolved. A hosted page alone does not solve Google session access.

## Other scope and references

Video cropping is experimental work preserved on a separate branch, not part of the active core review experience. Preserve existing private data and unfinished-job protections if touching related code.

Integrating the swiper into the user's personal website is planned but not implemented or deployed. Website work requires a new worktree in that separate repository. Its static GitHub Pages deployment cannot run the current Node/SQLite backend unchanged.

Start with README.md for the current setup, docs/architecture.md for implementation boundaries, docs/core-review-status.md for recorded validation, and docs/roadmap.md for future work. Earlier diagrams describe proposals; the architecture documentation describes the current desktop app.

Treat the iPhone Shortcut and hosted design as hypotheses to test, not working features. The product goal is fast, reliable cleanup with persistent decisions and a practical path from swipes to removing the intended Google Photos items.
