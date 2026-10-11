#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  if [[ -f /home/box/shared/cloudflare.env ]]; then
    set -a
    source /home/box/shared/cloudflare.env
    set +a
  fi
fi

node "$repository_root/scripts/build-userscript.mjs"
cd "$repository_root/worker"
npx --yes wrangler@4 deploy
