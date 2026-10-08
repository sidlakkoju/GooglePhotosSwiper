# Video trimming feasibility

Research date: October 5, 2026. This is an experiment and implementation plan, not a shipped editing feature.

The proposed workflow is feasible: download the stored video, create a shorter file locally, upload a new item, verify it, and only then offer to move the original to Trash. The current extension does not implement editing, uploading, or deletion.

## Local experiment

The open IMG_1130.MOV was identified by its media ID, duration, dimensions, and size. Two different items share this filename: the open 77-second video and an existing 11-second copy. Filenames are insufficient to identify which original should be replaced.

Google Photos marks the full video as Storage Saver quality. Its downloaded stored file is 50,199,818 bytes, approximately 76.86 seconds, and 1920 × 1080. The stored download cannot recover any original camera quality already discarded by Storage Saver.

A local AVFoundation passthrough export retained seconds 10–15. The output is exactly 5 seconds, 1920 × 1080, 2,589,614 bytes, with one video track and one audio track. Passthrough avoids deliberate re-encoding, but production trimming must test frame accuracy, keyframes, orientation, HDR, audio synchronization, and metadata across formats.

The clearly labeled file is PhotosSwipe_TEST_IMG_1130_10-15s.MOV. The original remains unchanged. The uploaded test copy has a distinct media ID: AF1QipN2SSJ5_RaE7lqissv5gDCsPwHFtMt7c6I3S0ji. Google Photos assigned the export time as its capture time, so date preservation is a demonstrated missing step in this experiment; the location metadata did carry over. Local experimental files are in the ignored .data/experiments/video-trim directory.

The [uploaded test clip](https://photos.google.com/photo/AF1QipN2SSJ5_RaE7lqissv5gDCsPwHFtMt7c6I3S0ji) remains in the account for review. No deletion was attempted. Keeping this copy alone does not save storage while the original remains. The potential size reduction is approximately 47.6 MB, or 94.8%, before any account storage accounting delay.

## Verification limit

The test copy’s duration, decoded resolution, live playback, unique media ID, and Backed up status were verified in Google Photos. A round-trip stored-file download was attempted, but Chrome blocked the video-downloads.googleusercontent.com page with ERR_BLOCKED_BY_CLIENT. No bypass was attempted. Therefore byte-for-byte integrity against the local export has not been verified.

## Available integration paths

- **Official Library API for new uploads:** appendonly permits uploading bytes and creating a new media item. Read access to app-created items permits verification. Google reports PROCESSING before READY for video; creating an item does not mean playback is ready. This path requires a Google Cloud OAuth client and additional user consent. No OAuth client was configured or account permission expanded in this experiment.
- **Existing undocumented web API for originals:** the researched clients expose stored-file download operations and moving known items to Trash. Our narrow adapter currently omits these write operations. No original was deleted or moved to Trash during this experiment.
- **Google Photos web UI:** normal browser upload can use the signed-in Google session. A test copy was uploaded through the signed-in web UI and verified in Google Photos: it plays, reports a 5-second duration, decodes at 1920 × 1080 with no playback error, and is marked Backed up. UI automation proves the workflow but does not establish a stable programmatic web upload endpoint.
- **Reverse-engineered mobile uploader:** GPMC supports uploads, but requires separate mobile authentication data. This is not interchangeable with our current browser session and is unnecessary for the first implementation.

## Required safeguards in an implementation

Persist a job with the exact original media ID, file digest, desired segment, metadata, and replacement ID. Download the stored file rather than re-exporting the lower-quality player preview. Preserve the capture date explicitly and verify it after upload; album membership, favorites, sharing, descriptions, and location do not automatically transfer to a new item. Verify processing completion, dimensions, intended duration, audio, and playback before offering deletion. Use a unique job identity and upload token/media ID checkpoints to avoid duplicate uploads on retry. A failed or interrupted upload must leave the original intact.

Ask before moving the original to Trash. Do not empty Trash automatically. Account storage reclamation and reporting should be verified separately; a smaller replacement existing in the library is not evidence that space was freed.

## Sources

- [Google: uploading media and video processing](https://developers.google.com/photos/library/guides/upload-media)
- [Google: access app-created media](https://developers.google.com/photos/library/guides/access-media-items)
- [Google: authorization scopes](https://developers.google.com/photos/overview/authorization)
- [Toolkit API source](https://github.com/xob0t/Google-Photos-Toolkit/blob/main/src/api/api.ts)
- [Web client payloads: GetDownloadToken, CheckDownloadToken, MoveToTrash](https://github.com/xob0t/google_photos_web_client/blob/main/gpwc/payloads.py)
- [GPMC: mobile API upload and separate authentication requirements](https://github.com/xob0t/gpmc)
