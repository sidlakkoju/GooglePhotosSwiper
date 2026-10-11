# Photos Swipe: UI/UX redesign, round 2

Mockups: `mockup.html` (mobile, self-contained), `light.png`, `dark.png`; desktop: `desktop-modal.html/.png`, `desktop-panel.html/.png`, `desktop-panel-light.html/.png` (1440x900 over a fake Google Photos backdrop). `desktop.png` is the superseded round-1 desktop mock.

## Decisions from Siddharth (round 2)
1. **Straight to Trash.** The primary action on Review is **Move N to Trash** (Google Photos Trash, restorable for 60 days). "Send to review album instead" is a secondary option under Review's ⋯ menu.
2. **Left = delete, right = keep**, with ✕ and ♥ buttons.
3. **Continuous stream, not month-by-month.** No "Next: September 2026" and no month or progress bar in the pill. The pill shows a running counter: `38 reviewed · 12 marked`. Review opens from the 🗑 badge (with a red count) or automatically after every N marked (default 25, set in Settings). After trashing, Done's primary button is **Keep swiping**, which continues the stream ("Up next: 1,204 unreviewed").

## Desktop layout
- **Centered window** (`desktop-modal.png`, 540px wide over a dimmed and blurred library). Pros: focused, biggest card, same layout as the phone. Cons: hides the library, so you lose context about where you are in it.
- **Right side panel** (`desktop-panel.png`, 420px docked; the current item is outlined in blue in the grid and marked items show a red ✕). Pros: the library stays visible, you can see where you are and what's marked, and it feels native to Google Photos. Cons: smaller card, and the grid underneath has to reflow (or gets covered).
- **Recommendation: side panel**; light version in `desktop-panel-light.png`. Esc closes it in both layouts.


## Problems with the current UI (from the v1.2.4 screenshots)
- The green theme and the browser-default serif text and form controls look unfinished.
- The swipe card shares the screen with 6 buttons, a zoom slider, 2 dropdowns and 3 lines of status text.
- Deleting takes 3 steps that aren't connected on screen: Send to review album, Open review album, then trash it in Google Photos. Move to Trash exists, but it's hidden behind an opt-in checkbox.

## New flow: three stages
1. **Swipe.** A full-bleed card with the next card peeking behind it, a counter pill (`38 reviewed · 12 marked`). Two big circular buttons: ✕ (delete, red glyph) and ♥ (keep, blue glyph). Two small ones: Undo and Enlarge. A trash badge shows how many items are queued and opens Review. Feedback comes from a toast ("Marked for deletion · Undo") and a DELETE/KEEP stamp on the card while you drag. There's no status text.
2. **Review.** Opens from the trash badge, or automatically after every N marked. It shows a "12 to delete · frees ~48 MB" header and a 3-column grid. Tap a photo to rescue it (it fades and gets a ↺ badge); long-press to enlarge. One primary button, **Move 11 to Trash**, with a line saying the items go to Google Photos Trash and can be restored for 60 days. The ⋯ menu holds "Send to review album instead".
3. **Done.** A ring, "44 MB freed", and reviewed/kept/deleted counts. The primary button is **Keep swiping** (continues the stream); the secondary link is "Open Trash in Google Photos".

Settings (gear) is a grouped-list sheet: Sync (and QR pairing), Show (media filter), Order, Review every N marked, History, Delete method (Trash / review album), and Lifetime freed.

## Decisions and why
- **Use the device's light or dark setting** (`prefers-color-scheme`), with Apple's system colors: blue `#007AFF`/`#0A84FF` for actions, red `#FF3B30`/`#FF453A` only for deleting, and grouped-list backgrounds. Apple's guidance is to use system colors that adapt to light and dark, and to keep the accent for interactive elements (HIG Color: https://developer.apple.com/design/human-interface-guidelines/color, Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode).
- **Use translucent blurred surfaces** for the toast, the bottom bar and the settings sheet, so content stays visible underneath (HIG Materials: https://developer.apple.com/design/human-interface-guidelines/materials).
- **Use the system font stack** (SF on Apple devices, Inter or system-ui elsewhere) with a short type scale of 28/20/17/15/12 (HIG Typography: https://developer.apple.com/design/human-interface-guidelines/typography).
- **Keep it restrained, like x.ai** (https://x.ai): true black in dark mode, monochrome surfaces, and a single accent. This page was described from public knowledge, not fetched.
- **Review before deleting, and never delete on a swipe.** This matches the leading swipe-cleanup apps. Swipewipe asks you to review marked photos before anything is deleted (https://swipewipe.com/). Slidebox keeps swiped photos in its own trash until you empty it (https://apps.apple.com/us/app/slidebox-photo-cleaner-app/id984305203). Comparison of these apps: https://photobroom.com/best/swipe-to-delete-photo-apps/. Google Photos Trash already keeps items for 60 days, so "Move to Trash" is the safe single step. The album path becomes a secondary option.
- **Make ♥ the keep button**, not ✓. It reads faster and matches dating-app conventions. This is open question 2.
- **Use 44pt+ touch targets** (72px primary buttons). Desktop shows keyboard hints in one caption line.

## Design tokens
These are in the `:root` and `.dark` blocks of `mockup.html`. In the userscript, apply them under `@media (prefers-color-scheme: dark)` on the shadow host.
```
--ps-bg #F2F2F7 / #000      --ps-surface rgba(255,255,255,.72) / rgba(28,28,30,.72) + blur(20px)
--ps-surface-solid #FFF / #1C1C1E   --ps-fill rgba(120,120,128,.12 / .24)
--ps-label #000 / #FFF      --ps-label2 rgba(60,60,67,.6) / rgba(235,235,245,.6)
--ps-sep rgba(60,60,67,.18) / rgba(84,84,88,.6)
--ps-accent #007AFF / #0A84FF   --ps-destructive #FF3B30 / #FF453A   --ps-success #34C759 / #30D158
--ps-r-sm 10  --ps-r-md 16  --ps-r-lg 24  --ps-r-pill 999
--ps-s1..s6 4 8 12 16 24 32
--ps-font -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, Inter, sans-serif
type: large 600 28/34 · title 600 20/25 · body 400 17/22 · callout 500 15/20 · caption 400 12/16
```

## Open questions for Siddharth
(1, 2, 3 and 5 are answered above.)
1. **Trash directly or album first?** I propose Move to Trash as the main button (recoverable for 60 days), with the review album tucked under ⋯. Is that OK?
2. **Swipe semantics.** Left = delete and right = keep? Should the keep button be ♥ or ✓? Should swipe-up mean something, like Favorite or Skip?
3. **Batching.** Should cleaning be organized by month like Swipewipe ("Next: September 2026"), or as a continuous stream in batches of 50?
4. **Stats.** Which matter to you: space freed this session, lifetime space freed, or counts? I'd show only space freed on the Done screen.
5. **Desktop.** Do you want a centered modal over Google Photos (as mocked), or a side panel that lets you see the library behind it?

## Implementation note for Engineering Lead (current control → new location)
| Current (lib/userscript-ui.mjs) | New |
|---|---|
| Close button | ✕ top right of the desktop panel; on phone, the gear sheet or the Done screen |
| Account email line | Settings › Sync row (subtitle) |
| Sync settings `<details>` (URL, token, Continue locally, Save and sync) | Settings › Sync (pushed page); QR pairing (#79) lives there |
| "Synced · N reviewed IDs", Ready/status text | Removed; toasts only on change or error, plus a small sync dot on the gear |
| Caption under photo (name · date · size) | Gradient overlay at the bottom of the card |
| "Swipe left to queue · right to keep" hint | First-run coach overlay only, plus the DELETE/KEEP stamp while dragging |
| × Queue / ✓ Keep | Big round ✕ / ♥ |
| Undo + "Next Undo: …" line | Small ↺ button; the toast says what was undone |
| Enlarge + Zoom slider | ⤢ button / Space; zoom by pinch or scroll in the enlarged view |
| Stats line | Counter pill + trash badge count; full stats on Done and Settings › Lifetime freed |
| Load 50 more / Refresh latest | Automatic prefetch (#61); "Refresh" in Settings |
| All media / Library order dropdowns | Settings › Show, Order |
| Send to review album / Open review album | Review › ⋯ › Send to review album instead (opens the album afterwards) |
| Enable Move to Trash checkbox + Move N to Trash + candidate list | Review screen primary button + grid; opt-in replaced by the confirmation of the button itself (Settings › Delete method can switch the default to album) |
| Decision history | Settings › History |

Keep #31's non-blocking swipe and the #77/#78 drag physics. The stamp opacity should follow the drag distance. Respect `prefers-reduced-motion` (#66).

## Tools that would help with UX design
- Figma, or me iterating directly on HTML mockups like these (fastest).
- Real-device screenshots from Siddharth's iPhone.
- A clickable prototype via a GitHub Pages link he can open on his phone.
