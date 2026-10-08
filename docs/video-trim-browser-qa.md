# Browser crop verification — October 6, 2026

Chrome was accessible for this run. The existing paired account and current 77-second IMG_1130.MOV were used, with the user's prior authorization. Neither existing same-name original was deleted, overwritten, or queued during these checks.

## Verified in Chrome

- C opens the editor from compact and enlarged review; the visible crop button also opens it.
- Start/end keyboard adjustments seek to their boundary. Pointer dragging follows the moved handle. A dragged selection around 10–15 seconds displays the selected duration.
- Space plays after focusing/scrubbing the range input. Playback restarts at the selected start when reaching the selected end.
- Cancel and Escape return to the same original; enlarged review stays open when its editor closes.
- The unchanged full-range selection cannot be approved.
- Responsive sizes 320×568, 390×844, 430×932 and 844×390 have no horizontal page overflow. The short portrait and landscape dialogs scroll. Pointer dragging was tested at 390×844. Actual iOS touch/Safari behavior remains untested. The viewport override was reset afterward.
- A real dragged-range approval saved a persistent job and locked the source against competing decisions.
- The prior exporter falsely rejected that range because it treated MOV decode preroll as presented content. The corrected exporter maps source/target edit segments and checks both presented boundaries. The range is preserved without reencoding.
- Retrying the saved job exported a 4.908008-second file that Chrome loaded at 1920×1080, readyState 4, with no media error. Space started and paused the local exported preview, and its playback position advanced while displaying decoded video.

## Fixes from this run

- Retry and Cancel no longer remain disabled after an operation fails: the workflow refreshes after clearing its running flag.
- Export jobs include a lazy local preview so the exported file can be inspected before cloud upload. Its keyboard events stay separate from review shortcuts.
- Export boundary checks account for edit mappings/preroll rather than rejecting otherwise valid dragged ranges.

## Upload investigation

A clearly named 8 KB synthetic video was uploaded through Google Photos' ordinary interface. Native Chrome DevTools confirmed the same-origin `/_/upload/uploadmedia/interactive?authuser=0` start request, resumable-upload headers, byte transfer with `upload, finalize` at offset zero, and the subsequent `mdpdU` creation RPC. Cookies and authentication remained in Chrome. This initially confirmed the website's transport; the app adapter was subsequently verified in the live crop run below. The synthetic test copy remains in the account.

The installed Photos Swipe bridge returned “Unsupported bridge command” for the new source operation. The user subsequently completed the requested extension reload to 1.2.0. The official upload fallback has no configured OAuth client/grant; the existing job stopped there, retaining its exported file and leaving the source decision unchanged. The later browser-provider run below passed cloud readiness/metadata/playback verification.

Browser proof: [actual exported clip](../test-results/crop-export-browser-20261006.png). No DevTools screenshots, cookies, or authentication headers are saved in this report.


## Pairing/connection follow-up

The parent tested the ordinary Chrome extension popup on the currently open Google Photos tab. An incorrect code and the expired morning code both displayed “Pairing code expired or incorrect. Generate a new one.” Existing pairing was retained. A fresh code paired successfully. An ordinary read-only batch loaded 42 items, so the older installed bridge's review/import pairing worked even though crop commands remained unsupported.

The old app handler briefly showed checking only in the obscured sidebar and then restored identical text. A stale local session also opened Sign in after Check connection, with an uncaught workspace-refresh rejection. The revised dialog displays checking text and a disabled Checking… button inside the modal, then a verification timestamp or error. Parent Chrome checks confirmed the timestamp and explicit legacy crop-update notice.

Closed-tab/same-account recovery, signed-out/mismatched accounts, disconnected workers and popup response races are covered by fixtures. The user’s only Photos tab was not closed to manufacture a live failure. The user subsequently reloaded extension 1.2.0 and crop uploading succeeded. Closed-tab/account recovery remains fixture-tested.


The parent also checked a tab without the Chrome extension relay in the in-app browser: the dialog visibly entered Checking… with the Check button disabled; after the actual 35-second wait it showed “No response from the extension” with install/reload instructions and enabled Check again. This is live missing-relay evidence; worker disconnection and account recovery remain fixture-tested despite the later successful crop run. [Connection dialog screenshot](../test-results/bridge-connection-chrome-20261006.png).

Final validation: all 75 tests pass with no skips, including native exporter regressions; syntax and UI wiring checks pass for 22 JavaScript files.


## Live saved-crop completion after Bridge 1.2.0 reload

Chrome verified the updated bridge. Resuming the existing authorized 77-second IMG_1130 crop initially revealed canonical GPS in E7 integer units. Backend field-specific errors isolated location; a temporary private tuple comparison established that E7 latitude/longitude matches the stored iTunes GPS, and reversed order does not. The diagnostic file/instrumentation were removed. E7 normalization now feeds both preserving export and remote-place verification; wrong/missing place, invalid ranges and fractional E7 data still fail.

The same saved job then completed end to end through the browser provider. Chrome displayed the verified-crop toast. Removal candidates increased from 37 to 38 and review advanced from 72 to 71 remaining; the next item was the other existing 11-second IMG_1130, with neither existing same-name video deleted. The original is only an unsent candidate, and the generated copy is kept/excluded.

Crop resumption now shows immediate “working” progress with disabled buttons before the long bridge operation, replacing the stale failure text. A deferred-response regression confirms a second click cannot start another run and failure restores usable controls.

## Final independent checks

Google Photos opened the exact generated replacement and played it. Its Info panel showed the reserved crop filename, 1920×1080, Backed up / Storage saver, July 5 at 5:17 PM GMT-05:00, and the original Shreveport place. The export and downloaded cloud-playback reports both measured 4.908 seconds and one audio track. Source metadata, remote metadata and decoded playback gates all passed.

Refresh latest followed by the next two library pages actually encountered the generated copy. SQLite recorded it as active, kept and excluded, including its durable seen identity. It did not become the next review card. The source remained active with decision remove and no album key; the other same-name original remained active and undecided. No album was sent and no Trash operation occurred.

The parent restarted only the verified local server, refreshed Chrome and confirmed the completed job, queue and exclusion persisted. C opened the editor again from compact and enlarged review; both were cancelled without creating another crop. The app remains running locally. Parent regression: **75 tests passed, no skips**, and syntax/UI checks passed for **22 files**.

[Completed app after restart](../test-results/crop-completed-app-20261006.png) · [Actual replacement in Google Photos](../test-results/crop-google-verified-20261006.png).


## Bridge 1.2.2 actual source-access check

The installed version/account were verified and the saved IMG_1129 job was retried. Archive bytes, source bytes, export and replacement upload remained zero/absent. The app reported a rejected network fetch. Local archive preflight returned 204 with all required headers. The same original’s ordinary Google Photos Download independently opened Chrome’s ERR_BLOCKED_BY_CLIENT page for video-downloads.googleusercontent.com. No redirect bypass, cookie export, CLI source request or new permissions were used. The source remained queued/pending and excluded from album sending. The exact original (69 seconds, 42.3 MB) was reopened for a user handoff; the separate 14-second original remains untouched.

[Exact original for manual access](../test-results/crop-1129-original-handoff-20261006.png). The saved crop is not yet live-verified end to end; 94 local tests and 24-file checks pass.
