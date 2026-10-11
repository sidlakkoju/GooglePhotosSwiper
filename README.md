# Photos Swipe — experimental video cropping

This branch, `codex/video-cropping`, preserves the video segment cropping implementation before it was removed from the core desktop app. **Use [main](https://github.com/sidlakkoju/GooglePhotosSwiper/tree/main) for the current swipe-review experience.** Later playback, pagination, queue and storage-counter fixes live on main and have not been merged here.

## Feature and limits

The experiment opens a video segment editor with C from compact or enlarged review. Drag the start/end handles to select a range; playback and scrubbing follow the selection. Approval saves a resumable crop job, queues the exact original immediately and starts preparing/uploading its replacement. The original cannot be sent to a removal album until the replacement passes verification. Cropped copies are automatically kept/excluded.

One authorized video passed the browser-session export/upload/metadata/playback flow. Another stored-original download was blocked by Chrome, and download behavior has not been reliable across videos. ZIP source handling and resumable checkpoints were implemented, but are not proof that every Google download works. The optional official OAuth upload provider has not been tested with a live grant. **This is experimental; it is not a reliable replacement for main.**

No Trash or permanent-deletion action is implemented. A failed export/upload does not authorize deleting an original.

## Run in an isolated workspace

The web app requires Node.js 22.13 or newer and Chrome. Native export additionally requires macOS and an Xcode installation providing AVFoundation/Swift tools. Sources are bounded to 1 GB, with disk-space and media/metadata verification checks.

Stop any other Photos Swipe server before starting this checkout on port 3000. Keep its `.data` separate from the active personal workspace, and make a private backup before switching branches with existing jobs. Install/reload this checkout's extension, open Google Photos in Chrome, sign into the local app and pair through its generated code.

```sh
npm start
npm test
npm run check
```

Google cookies and page tokens remain in Chrome. Private source/export files, account metadata, pairing/OAuth credentials and upload/download checkpoints are not included in the Git repository. Upload tests use synthetic media unless a specific personal source is explicitly authorized.

## Handoff documents

- [Latest implementation decisions](docs/video-trim-decisions.md)
- [Implementation plan](docs/video-trim-implementation.md)
- [Research](docs/video-trimming-research.md)
- [Implementation status](docs/video-trim-status.md)
- [Browser QA](docs/video-trim-browser-qa.md)
- [Runtime/browser constraints](docs/video-trim-runtime-context.md)
- [Archive-download handoff and blocker](docs/video-trim-archive-handoff.md)

These documents record the experiment's development and verification history. Read the decisions and latest status before resuming work; earlier planning defaults are superseded by the confirmed decisions. Generated replacement IDs, job state and recovery files remain in the original private local workspace, not GitHub.

Photos API payloads are adapted from Google Photos Toolkit; [third-party attribution](extension/THIRD_PARTY_NOTICES.md) and its [MIT notice](extension/LICENSE-GPTK) are retained.

## Publication validation (October 10, 2026)

The isolated branch test run completed with 92 passing tests and 2 skipped tests that require an optional stored-source media fixture. The synthetic native export test passed. This validates local behavior and mocked provider responses; it does not resolve the live Google download blocker or validate the optional OAuth provider with a real grant.
