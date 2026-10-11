# Privacy and local data

Photos Swipe is a personal local workspace. The backend listens on loopback only; no hosted service is deployed. Its local authentication and extension pairing are independent of the Google sign-in held in Chrome.

## Where information lives

| Store | Contents | Included in GitHub source? |
| --- | --- | --- |
| `.data/photos.sqlite` and sidecars | Account label/hash, imported metadata and preview URLs, decisions, session/pair hashes, album jobs, reconciliation, compatibility records | No |
| `.data/access-code`, `.data/local-login-url`, `.env` | Local sign-in credentials/configuration | No |
| Chrome extension local storage | Pairing bearer credential; experimental branch can hold crop upload/download checkpoints | No |
| App browser IndexedDB | Cached image previews | No |
| Browser memory | Object URLs and buffered video previews | No |
| `.data/trim-jobs` and other experimental media | Original/export/recovery files and optional OAuth credentials on the crop branch | No |
| `test-results/` | Live verification screenshots and recordings/artifacts | No |
| `test/fixtures/synthetic-video.mov` | Generated test video, with no personal account media | Yes |

Google login cookies and Photos page tokens stay in Chrome. The server may fetch a signed/allowlisted video preview URL without cookies; imported preview URLs and local state should be treated as private. Signing out does not erase the browser preview cache or SQLite decisions.

## Backup and recovery

Stop the app before copying the entire `.data/` directory to a private backup location. Copying only `photos.sqlite` while a writer is active can omit SQLite WAL changes. The backup contains credentials and personal metadata; GitHub is not its backup destination.

A source clone starts with a new local workspace and requires sign-in, extension installation and pairing. Restoring `.data` restores backend state, but does not restore Chrome extension storage or IndexedDB. If a browser pairing credential is missing or revoked, generate a new code and pair the same account again.

Use **Revoke extension pairing** in the app to invalidate the backend grant. **Forget pairing** in the extension removes its browser-side copy. Neither action changes Google login or deletes photos.

## Scope of writes

The core bridge creates/finds a review album and adds selected candidates to it. It performs no sharing, Trash mutation or permanent deletion. Deletion checks read state only. A library/album API format change can interrupt an operation; failed/unknown checks do not justify discarding data or treating absent items as permanently deleted.

The cropping feature branch may upload replacement videos and contains optional OAuth setup. Those providers are absent from active core. Its private jobs and media are retained locally, and pending originals remain protected until that feature is revisited.
