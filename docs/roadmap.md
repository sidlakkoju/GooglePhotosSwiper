# Scope and next steps

## Current desktop core

The current app supports persistent photo/video review, muted video autoplay, buffered scrubbing/looping, enlarged review and queue inspection, pagination past reviewed pages, verified review-album updates, read-only deletion reconciliation, and queue/Trash storage estimates. Main's validation is documented in [core-review-status.md](core-review-status.md).

## Experimental video cropping

Cropping remains on `codex/video-cropping`. Its editor/exporter/browser-session upload path succeeded for one authorized video, but stored-original download and Google browser behavior were not reliable across cases. Chrome blocked a later original download. The optional official upload provider was implemented but not verified with a live OAuth grant.

Revisit source retrieval, upload/metadata verification and resumable-job behavior before merging any cropping UI into core. Bring the later core playback, queue, storage and pagination fixes onto that branch as part of integration. Preserve the no-deletion boundary and keep generated replacements out of ordinary review.

## Personal website

[personal-site-integration.md](personal-site-integration.md) is a local-only plan. No website files or deployment were changed. Any work in the personal website repository must use a new worktree. A static GitHub Pages deployment cannot run this backend unchanged.

## iPhone and hosting

Responsive browser layouts have been checked, but the Google connection still depends on a Chrome desktop extension and the local Mac/server. A standalone iPhone experience needs a separately designed connection, authentication and data-storage path. Hosting, cost/retention choices, account boundaries and physical iOS/Safari tests remain future work.
