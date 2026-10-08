# Video crop status — October 6, 2026

The complete browser-session crop flow has now succeeded in Chrome with Desktop Bridge 1.2.0: stored-source export, Google Photos upload/creation, metadata and decoded-playback verification, and the exact original queued unsent. The new cropped copy is automatically kept and excluded. The local app is running at localhost:3000. No original was deleted or overwritten; both existing same-name IMG_1130 videos remain. The personal website was not modified or deployed.

## Browser evidence

C and the visible crop button open editing in compact and enlarged review. Boundary dragging seeks to the moved handle; keyboard adjustments, independent scrubbing, Space after scrubbing, selection playback/restart, Cancel, and Escape were exercised. Cancelling from enlarged review retains that viewer and the same original. Responsive layouts were checked at 320×568, 390×844, 430×932 and 844×390; there is no horizontal page overflow and short dialogs scroll. Actual iOS/Safari touch behavior is still untested.

A real dragged range on the authorized 77-second IMG_1130.MOV exposed an export-check bug: raw decode preroll was incorrectly treated as displayed content. Verification now maps MOV source/target edit segments and checks both presented boundaries. The selected range remains unchanged and its compressed content is preserved without reencoding.

The resulting clip is 4.908008 seconds, 1920×1080, with one audio track. Chrome loaded it at readyState 4 with no media error, displayed decoded video, and played/paused it. The native timing error for the tested boundaries was 0.0000135 seconds, below one frame. This stored source is VP9, which the native image decoder cannot decode; Chrome supplies the playback evidence.

[Browser QA details](video-trim-browser-qa.md) · [export and recovery screenshot](../test-results/crop-export-browser-20261006.png)

## Implemented

- iOS-style handles, sampled timeline frames, scrubbing and selected playback from both review views.
- Durable account/source/revision-bound jobs; canonical source metadata confirmation; source-file download and local preserving export. Metadata repair reexports the saved source before uploading.
- A lazy local exported-clip preview, with its keyboard input kept separate from review decisions.
- Browser-session upload initialization, bounded aligned chunks, offset reconciliation, opaque acknowledgement handling, exact generated-copy identity checks and processing separation. Cookies/page authentication stay in the paired Google Photos MAIN world; upload session URLs/tokens stay in Chrome storage, not the backend.
- Generated-name reservations before upload and exact generated IDs after acknowledgement, excluded across import/restart/rename. Original-state, time/place, readiness, duration/dimensions/audio and decoded playback gates precede the transaction that queues the exact original unsent. Sending it to an album remains a separate user action; no deletion command exists.
- Browser uploads default for new jobs. Optional official OAuth uploads remain available, with explicit account consent and configuration. In-flight jobs retain their provider.
- Safe pre-creation cancellation, terminal-state guards, scoped Chrome checkpoint cleanup, and safe abandonment once a replacement is identified. An uncertain creation is reconciled rather than blindly repeated. Retry and Cancel remain usable after errors.

## Validation

The latest full local suite passed all **75 tests**, with **75 passes and no skips** on this Mac. Syntax and UI wiring checks pass for **22 JavaScript files**. Coverage includes existing review/album behavior, native exports and metadata/orientation, the real dragged range, account/revision locks, resumable/ambiguous uploads, source metadata repair, provider freezing, binary route authentication/bounds, cancelled-job races, generated-copy exclusions, malformed private responses and playback/metadata failures. The successful authorized crop separately establishes the tested live browser flow; fixtures cover additional interruption/failure cases.

A normal website upload of a clearly named 8 KB synthetic clip initially confirmed the current same-origin upload transport, resumable headers, byte finalization and `mdpdU` creation RPC. The synthetic test copy remains in the account. The subsequent app crop below independently verified the adapter end to end.

## Live upload and remaining coverage

After the user reloaded the extension, Chrome verified Bridge 1.2.0. The saved authorized 77-second IMG_1130 crop initially stopped on source location validation. Google's canonical GPS is an E7 integer tuple, latitude first; the backend expected degrees. A private comparison confirmed dividing by ten million matches the stored original's iTunes GPS. No coordinate values, cookies or URLs were logged. The temporary diagnostic file and instrumentation were removed.

The backend now normalizes supported E7 coordinates before source export and replacement-place verification, with finite/integer/range validation and unchanged identity/file-size/date/timezone gates. This repaired the saved job's canonical metadata and reexported it before uploading. Chrome then completed the existing job, displayed “Crop verified,” and queued its exact original without sending it to an album. The removal queue changed from 37 to 38; the next review item was the separate existing 11-second IMG_1130, rather than the generated clip.

The current live crop verifies the browser provider's upload, creation, processing and metadata/playback gates. The actual Google Photos copy is backed up with the original date, timezone and place; export and cloud-playback reports both measured 4.908 seconds at 1920×1080 with audio. Reimport encountered the copy and kept/excluded it; a server restart preserved that exclusion and the unsent source candidate. C opened editing again in compact/enlarged views. [Final browser QA](video-trim-browser-qa.md) records the checks and screenshots. Forced mid-upload/network interruption remains fixture-tested rather than live-tested. Broader codecs/HDR, the optional official OAuth path and actual iOS/Safari touch behavior remain unverified.

Capture-time correction uses the current Toolkit's timestamp RPC only on an exact generated copy, with whole-second source timestamps and a known millisecond timezone offset. Unsupported precision and failed place preservation stop before queueing the original. Automatic place editing is not implemented: canonical geometry/place IDs are not invented. Passthrough sources that cannot satisfy precision/media-preservation checks fail explicitly. Sources are capped at 1 GB with 2 GB free disk required; macOS/Xcode is required for native export.

## Protocol sources

- [Historical browser uploader](https://github.com/3846masa/upload-gphotos/blob/b01bfd884cb0075f1c143e766ed1981707314e9d/src/Requestor.ts): upload initialization, finalization and creation framing; its age requires live verification.
- [Historical upload response documentation](https://github.com/simonedegiacomi/gphotosuploader/blob/master/documentation/how-upload-works.md): prior creation framing. The new parser verifies canonical generated identity rather than assuming an echoed token still exists.
- [Toolkit API](https://github.com/xob0t/Google-Photos-Toolkit/blob/main/src/api/api.ts) and [parser](https://github.com/xob0t/Google-Photos-Toolkit/blob/main/src/api/parser.ts): canonical source metadata and narrow timestamp operations; existing MIT attribution remains in the extension.
- [Toolkit location filter](https://github.com/xob0t/Google-Photos-Toolkit/blob/main/src/filters.ts): E7-to-degree conversion and latitude/longitude axis order, corroborated against the stored original GPS.
- [Official resumable upload documentation](https://developers.google.com/photos/library/guides/resumable-uploads): optional official adapter.

The user-confirmed choices in video-trim-decisions.md retain priority: browser session first, originals queued unsent only after verification, generated copies kept/excluded, no original deletions or deployment.

## Connection repair — October 6 scheduled follow-up

The Google Photos dialog now shows checking progress inside the modal, disables duplicate checks, and reports a fresh account verification time. Local authentication is checked first; an expired app session clears stale connection text and the displayed pairing code. Failures are visible and controls become usable again. The popup shows pairing progress and keeps a delayed startup status from overwriting the result.

Bridge 1.2.0 reports its version and video-upload capability. Older installed bridges can retain ordinary review/import support while the app explicitly says video crops need an update. Extension/local request failures, a disconnected relay, missing Photos tabs, signed-out pages and account mismatches produce recovery instructions. When the paired tab closed, the new bridge reads open Photos identities and restores only the exact paired account; it never switches away from a live tab that changed accounts. Permissions and account/library/crop state are unchanged.

Live checks by the parent found that the old installed bridge still imported 42 items and accepted a fresh pairing code. Incorrect and expired codes visibly failed without replacing the working pairing. The previous Check connection handler displayed pending text only behind the modal and let an expired local-session refresh reject without feedback. The new app UI showed its verified timestamp and the old bridge's crop-update notice. An in-app-browser tab without the Chrome bridge showed visible pending state, then the real 35-second timeout error with actionable reload instructions and its Check button enabled again. The user subsequently reloaded Bridge 1.2.0; its identity and crop operation were verified live. Closed-tab recovery remains fixture-tested.

Regression coverage now includes visible check/retry states, local-auth expiry, legacy capabilities, missing/disconnected relay responses, popup pending/results and stale response races, exact-account tab recovery, no-tab/signed-out/account mismatch, invalid/expired pairing preserving existing state, and serving every public JavaScript module. The static allowlist regression prevents a newly imported module from leaving the app inert with a 404.


[Connection dialog screenshot](../test-results/bridge-connection-chrome-20261006.png). Final full regression: **75 tests pass, no skips**; syntax/static UI checks pass for **22 JavaScript files**. Native export and existing album/review tests remain included. The user completed the bundled extension reload; no permission changes were needed.


## Stored download and approval timing follow-up

The latest user choice queues the original immediately on Approve and advances review while eagerly preparing/uploading its crop. Until the replacement passes every verification gate, the queued source is marked pending and cannot be sent to the review album; other eligible candidates remain sendable. Approval/job creation is atomic and revision-bound. Failure keeps the pending queue entry with Retry; safe Cancel/Undo restores the previous decision. This supersedes older descriptions of queueing only after verification.

The repeated IMG_1129 stored-download failure was traced to an actual successful Google RPC returning a pending token/status record, without any ready file or archive yet. Earlier code polled once and misleadingly combined pending and archive errors. Bridge 1.2.1 separates initialization/status reads, retains the exact account/job/source-bound token only in Chrome, and polls it boundedly. Retry reuses that token. Ready responses require the same token plus exact source filename/byte size and an allowlisted Google media URL. Archives, malformed responses and still-pending requests have separate recovery text. Closed jobs stop polling and clean their scoped checkpoint.

The source download fix and new approval/cancellation behavior are fixture-tested; the parent's resumed IMG_1129 live result is recorded in the browser QA document. Permissions are unchanged. No original has been trashed or deleted.


## Automatic original ZIP handling — implemented; live source access blocked

The IMG_1129 download subsequently progressed from pending to a ZIP archive, so bounded polling alone was insufficient. After the user reset usage and asked to continue, Bridge 1.2.2 gained automatic source ZIP streaming and extraction. Archive tokens/URLs and Google credentials stay in Chrome. A private, account/job-bound binary route retains resumable archive offsets separately from source bytes. The fixed-path Python stdlib extractor accepts only the exact original movie, checks size and CRC, bounds central-directory/decoded bytes, and rejects traversal, links, encryption, duplicate/ambiguous paths, extra files and unsupported compression. Permissions are unchanged.

The extracted source then follows existing native timing, dimensions, codec/audio/orientation and metadata export checks. Source revision/state and terminal-status guards remain enforced; a validated extracted source can resume locally without downloading again. The source stays queued pending replacement verification until every existing upload/metadata/playback gate passes. No original is trashed/deleted or automatically sent to an album.

All 94 local tests pass with no skips, including the real stored movie through ZIP extraction/export and local resume after the validated-source checkpoint. Syntax and UI checks pass for 24 JavaScript files. The parent verified the installed Bridge 1.2.2 and retried the exact saved job. Chrome rejected the source GET before any archive/source bytes arrived. Google Photos’ ordinary Download action independently showed ERR_BLOCKED_BY_CLIENT and ‘This page has been blocked by Chrome’ for video-downloads.googleusercontent.com. No replacement was exported/uploaded. The parent handed source access to the user rather than bypassing the browser block; tentative redirect changes were reverted. Live completion remains blocked on obtaining the exact 69-second original, not on another extension reload.
