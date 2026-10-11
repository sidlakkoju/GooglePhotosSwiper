# Setup and daily use

## Install and start

Use Node.js 22.13 or newer and Chrome. Clone this repository and run `npm start` from its root; no package installation is required. The process must stay running while the app is used. Stop it with Ctrl+C in its terminal.

The server listens on `127.0.0.1:3000`. Open **http://localhost:3000/** in Chrome. The extension trusts this exact origin. Changing `PORT` alone does not update the bridge configuration.

At first startup, the app creates a private `.data/` directory containing:

- `access-code`: local sign-in code, generated unless `LOCAL_ACCESS_CODE` is configured.
- `local-login-url`: a convenience access link containing that code.
- `photos.sqlite` and SQLite sidecar files: persistent app state.

Enter the code on the local sign-in form, or open the saved access link once. Do not share either credential file. The app removes the unlock fragment from browser history after using it. Sessions last 12 hours. Signing out of the local app does not sign out of Google Photos or clear saved decisions.

Optional configuration: copy `.env.example` to `.env` and set a private `LOCAL_ACCESS_CODE`. `.env` is ignored by Git.

## Install and pair the Chrome bridge

1. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
2. Select the repository's `extension` folder. Reload the app tab after installation.
3. Open Google Photos in another Chrome tab and sign into the intended Google account.
4. In Photos Swipe, choose **Google Photos → Generate pairing code**.
5. Switch to the Google Photos tab and open the Photos Swipe extension popup. Enter the pairing code and pair.
6. Return to Photos Swipe and choose **Check connection**. Confirm the account, close the dialog, and load a batch.

Pairing codes expire after five minutes and work once. The backend binds the workspace to the paired account; a different Google account is rejected. A closed paired tab can be recovered through another open Photos tab only after its account matches. Keep that account's Photos tab open.

After updating extension code, reload its card in `chrome://extensions`, then reload the app tab. No re-pairing is normally needed if the saved credential is still valid. Bridge 1.3.1 adds progress-preserving latest refresh.

## Typical review session

Load a batch, then keep or queue each photo/video using buttons, dragging or arrow keys. Use F to inspect it more closely and Space for video playback. Review the removal queue through its thumbnails and change unwanted selections to **Keep instead**.

Send the queue to a review album, wait for full membership verification, and open the album in Google Photos. Select the intended items and choose **More options → Move to trash**. The app itself never performs deletion. Use **Check deleted items** afterwards to reconcile confirmed Trash items.

Sending a fully verified batch clears the working queue and its queue storage estimate, but retains review decisions and the album link. Failed/partial updates stay available for retry. Undo history belongs to the current app tab and resets on page reload or a successful album send; stored decisions persist. After sending, a new swipe enables Undo again. Failed sends retain Undo history.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Local page does not load | Keep `npm start` running; check port 3000 before starting a second process |
| Bridge absent or disconnected | Use Chrome, reload the extension and app, open the paired Photos account, then Check connection |
| Sign-in expired | Reopen the local access link or enter the local code again |
| Pairing fails | Generate a fresh code; pair from the popup on the intended Photos tab |
| Refresh latest asks for an update | Reload bridge 1.3.1 or newer and the app tab |
| A page contains only reviewed items | Load more scans past these pages and reports new review items separately |
| Scan reaches its safety bound | Load more continues from its saved cursor; a repeated cursor instead asks for a Photos-tab reload |
| Video cannot buffer/play | Retry with the Photos tab connected; previews above 512 MB must be opened in Google Photos |
| Album update fails | Retry and verify; the bridge checks existing membership before adding missing items |
| An old album is unavailable | The bridge can find/create a replacement while retaining pending candidates |
| Deletion check is unknown | Local state stays unchanged; do not infer permanent deletion from an absent result |

The browser-readable guide is served at `/guide.html`. Back up local state as described in [privacy.md](privacy.md); GitHub source backups do not include the private database.
