# Photos Swipe flow — review notes

Architecture is **proposed**, not verified against a running build. Method names are the ones named for commit `6db9ab355e4797327e4078cf87a2b6994d36cf73`. No call order or signatures beyond those names are claimed.

## What the canvas argues

Three lanes on one canvas, left to right: import batch, swipe anytime, review queue, apply, report.

- iPhone: Google Photos webpage plus a dashed amber callout, **Prototype needed**, for Apple Shortcut + Run JavaScript on Webpage. Swipe anytime opens the hosted app. There is no iPhone apply path.
- Desktop: two dashed blue **Google origin** islands (import, then apply) tied by one browser-session line. Userscript / extension is import and apply only. Cookies and anti-CSRF stay on that line.
- Session boundary: a dashed red band. The hosted backend never receives Google cookies or anti-CSRF tokens. Only app auth is below the line.
- Hosted app: batch store, swipe card (left = mark for removal, not a delete; right = keep; undo reverses an app decision only), review queue with the example record, pending handoff, report.

Toolkit labels: `getItemsByTakenDate`, `getItemsByUploadedDate`, `getItemInfoExt`, `createAlbum`, `addItemsToAlbum (mediaKey)`, `moveItemsToTrash (dedupKey)`, `restoreFromTrash (dedupKey)`. `restoreFromTrash` is on the apply toolkit, not the swipe undo.

## Render

`references/render_excalidraw.py` via `/workspace/photos-swipe-flow/.venv` (Playwright + Chromium). The skill template’s unversioned `esm.sh/@excalidraw/excalidraw` import 404’d on `@braintree/sanitize-url`; the template import was pinned to `@excalidraw/excalidraw@0.18.0` so `exportToSvg` would load. PNG was rendered with that script and inspected with the Read tool (full frame plus crops) over three passes.

## Visual issues fixed

- Boundary sentence was cut by the import arrows. Moved into the open span of the band.
- “item info” sat inside the boundary band. Moved above the batch store.
- “crosses back” sat inside the boundary band. Moved beside the result arrow in the desktop lane.
- “opens the hosted app” was covered by the cookie chip. Moved under the iPhone swipe copy.
- “item keys only” overlapped “The same browser session reappears at apply.” Separated.
- “anytime” overlapped “app decision only” and the batch-to-swipe arrow. Separated.
- iPhone and desktop import arrows landed on the same point. Split the landings (center vs right edge of the batch).

## Remaining nits

- The keep arrow meets the left edge of the queue stack on purpose.
- The lower-right of the hosted lane is open under the report list. No collisions there.
- No clipped method names, no text inside the session-boundary sentence, no overlapping arrowheads on the last render.
