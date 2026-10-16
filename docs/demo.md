# Demo build

`npm run build:demo` builds a static, fully interactive copy of the real Photos Swipe UI into `demo-dist/` (gitignored). It runs the same `mountPhotosSwipe` code as the userscript, with demo mode switched on:

- 14 sample items (13 illustrated landscapes and one short video) with made-up file names, dates, places and sizes. Two are marked *stored free*.
- A fake library answers the same operations as Google Photos (`library`, `mediaURL`, `video`, `moveToTrash`, `trashPage`, `itemState`). Sharing, albums and sync aren't available.
- Progress lives in an in-memory IndexedDB stand-in, so nothing is written to the browser and a reload starts fresh.
- The overlay opens straight away. There's no launcher, close button, sign-in or sync. Open in Google Photos and Share only show a short "Demo:" message.
- **Move N to Trash** skips the confirmation, removes the items from the sample library and says "Demo: nothing was deleted." Settings and the done screen have **Reset demo**.

```
demo-dist/
├─ index.html              black page that fills its viewport
├─ photos-swipe-demo.js    the bundled UI and sample library
└─ media/                  *.svg landscapes and lake-loop.mp4
```

Every path is relative, so the folder works from any subpath (for example `https://sidlakkoju.github.io/photos-swipe/demo/`). A Content-Security-Policy meta tag blocks every request outside the folder.

The video is recorded once with `node scripts/record-demo-video.mjs` (Playwright WebKit, H.264) and committed at `demo/media/lake-loop.mp4`. The landscapes are generated at build time from `lib/userscript-demo.mjs`.

## Embedding

Load the page in an `<iframe>` so its media queries follow the frame's own size: phone-sized on desktop, full screen on a phone.

```html
<iframe src="/photos-swipe/demo/?embed=1" title="Photos Swipe demo" style="width:390px;height:844px;border:0"></iframe>
```

| | |
| --- | --- |
| `?embed=1` | Same UI, tuned for an embed: the built-in first-run coach is hidden (the page shows its own) and nothing grabs focus or scrolls the parent page on load. |
| `?embed=1&top=50` | Top safe-area inset in CSS px (0 to 100; anything else is ignored, and it only applies with `embed=1`). The ambient photo backdrop still fills the whole frame, but the header, sheets and Going to Trash start below the inset, so a parent that draws its own transparent status bar (time, island, icons) over the top of the iframe doesn't cover any controls. It sets `--ps-safe-top` on the shadow host, the variable every top inset in the app reads. |
| Demo → parent | `{type:'photos-swipe-demo', event:'ready'}` once the deck has opened. |
| Demo → parent | `{type:'photos-swipe-demo', event:'first-swipe'}` after the first keep or delete, so the parent can hide its coach mark. Sent once per page load. |
| Parent → demo | `{type:'photos-swipe-demo', command:'reset'}` reloads the demo with a fresh deck. Only messages from the parent window are accepted. |

Messages to the parent use `targetOrigin '*'`; they carry no data beyond the event name.
