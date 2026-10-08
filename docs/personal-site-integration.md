# Local personal-site integration plan

Status: desktop workflow approved by Sid on October 4, 2026. Planning only; no website edits or deployment in this phase.

## First experience

Add a “Photos” link to the personal website that opens `/photos`. That page contains the actual swiper within the site layout, with a small link back to the homepage. Preserve the simpler Google Photos UI: account email, review and removal queue, filters/sorting, batch loading, and connection/sign-out controls. Avoid the homepage's simulation behind the photo card, where it would compete with the image and gestures.

This version runs locally. Astro serves the personal site at `http://localhost:4321`; the current Node backend runs at `http://localhost:3000`. The Chrome extension still reads the signed-in Google Photos tab. SQLite stays in this GooglePhotos project's `.data` directory. No cloud account, new Google OAuth project, hosted backend, or deployment is needed.

## Findings from the existing website

- Project: `/Users/siddharthlakkoju/Documents/Code/website/site`.
- Astro dependency: `^6.1.5`, with `dev`, `build`, and `preview` scripts.
- `src/pages/index.astro` contains the homepage markup, personal links, and a Rust/WebAssembly gravity simulation with its own overlay controls.
- `astro.config.mjs` declares `https://sidlakkoju.github.io` with no base path.
- There is currently one page, `index.astro`, rather than a shared layout/component hierarchy.

These findings come from the local files. The public website was not modified or deployed.

## Proposed changes, in order

Before implementation, create a **new worktree for the personal website**, as Sid requested. Inspect its current branch and uncommitted changes to choose the correct baseline; preserve the existing checkout. All website edits and integration testing belong in that new worktree.

1. **Make the swiper mountable.** Refactor the frontend into a module that accepts a root element and configuration, e.g. `mountPhotosSwipe(root, { apiBase: '/api' })`. Scope element queries and CSS to that root. Keep the existing standalone page as a small adapter so the proven desktop setup continues to work during integration. Add a teardown method for listeners, timers, and object URLs.
2. **Extract a minimal Astro layout.** Share the site's typography, title/favicon, and navigation between the homepage and a new `src/pages/photos.astro`. Keep the homepage's WASM simulation and pause overlay specific to the homepage.
3. **Render the swiper directly at `/photos`.** Use an Astro component to provide its markup and load the client module. Do not embed the existing app in an iframe: its current frame policy blocks embedding, and a direct component offers cleaner navigation and styling.
4. **Proxy the app API during local development.** Configure Astro/Vite's dev proxy for `/api` to `http://localhost:3000`, preserving cookies and response headers. The browser sees one frontend origin. Audit the proxy's Host and Origin behavior; the backend currently rejects unexpected origins, so an explicit local UI-origin configuration is required. Do not use wildcard CORS or remove request validation.
5. **Allow the exact local site origin in the extension.** The bridge currently trusts only `http://localhost:3000`, both in the content relay and sender checks. Add an explicit configured allowlist for `http://localhost:4321`; keep the extension's backend endpoint at port 3000. Pairing, bearer credentials, and account validation stay intact. Merely moving the HTML to the personal site will not work without these changes.
6. **Add one local launcher.** A script starts the backend and Astro together, checks port conflicts, and stops both cleanly. Document how to access the local sign-in code on the Astro page. An app sign-out must not sign out of Google Photos.
7. **Validate the combined experience.** Check sign-in, pairing, account mismatch, media previews/video, swipe/undo, queue/album updates, deletion reconciliation, navigation away/back, and reload persistence. Use generated test media for writes; do not delete Sid's photos. Also verify that homepage simulation behavior and the website's production build are unaffected.

## File ownership and deployment separation

During the implementation phase, add the Astro route and shared components to the website project; keep the private backend and `.data` here. Avoid copying the database, login links, or preview cache into website assets or a public repository. Decide whether the reusable frontend is a local package or a shared module before copying code, so the standalone and website versions do not diverge.

A dev-only route/link can keep the local experiment out of the production website build until a later deployment is explicitly approved. A GitHub Pages build cannot run the Node/SQLite backend. Nothing in this plan changes the existing deployment workflow.

## Acceptance criteria

- The swiper renders directly in the personal site's `/photos` page.
- The app remains private to the local machine and paired account.
- Both servers start with one documented local command.
- Saved decisions survive restarts and imports; confirmed Trash items leave the active review queue.
- Unknown or failed Google checks do not discard an item.
- No unexpected API requests, leaked credentials, duplicate album additions, or homepage style/listener collisions.
- No deployment or hosted-service costs are introduced.

## Deferred

Hosting, private hosted authentication, remote data/media storage, and iOS integration remain separate phases. Removing the Mac requirement on iPhone requires a hosted data path and an iOS-compatible Google Photos connection mechanism; the desktop extension does not solve that by itself.
