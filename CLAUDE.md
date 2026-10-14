# Photos Swipe

## Code style
- Do not write code comments or inline comments.

## Testing
- Browser tests need Playwright and Chrome; install once without touching package.json: `npm i --no-save --no-package-lock playwright && npx playwright install chromium chromium-headless-shell`.
- `npm test` must pass with 0 failed and 0 skipped before merging.
