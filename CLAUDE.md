# Photos Swipe

## Code style
- Do not write code comments or inline comments.

## Testing
- Browser tests need Playwright and Chrome; install once without touching package.json: `npm i --no-save --no-package-lock playwright && npx playwright install chromium chromium-headless-shell`.
- `npm test` (runs with `--test-concurrency=4`; higher concurrency starves the timing-sensitive userscript tests while browser tests run) must pass with 0 failed and 0 skipped before merging.

## Personal site demo
- sidlakkoju.github.io/photos-swipe/ embeds a live demo built from this repo (`npm run build:demo` → `demo-dist/`), and its "How it works" diagram describes this app's architecture.
- Any change to Photos Swipe that users can see (UI, copy, behavior, architecture) must also update the site: rebuild the demo, copy `demo-dist/` into `site/public/photos-swipe/demo/` in github.com/sidlakkoju/sidlakkoju.github.io, update the project page copy or diagram if they changed, and ship both together.
