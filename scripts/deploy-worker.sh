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
node --check "$repository_root/userscript/photoswiper-app.user.js"
node "$repository_root/scripts/build-userscript.mjs" --check
node "$repository_root/scripts/sign-release.mjs"
cd "$repository_root/worker"
database_list="$(npx --yes wrangler@4 d1 list --json)"
database_id="$(printf '%s' "$database_list" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const db=JSON.parse(s).find(d=>d.name==="photoswiper-sync");if(db)process.stdout.write(db.uuid||db.id);});')"
if [[ -z "$database_id" ]]; then
  npx --yes wrangler@4 d1 create photoswiper-sync
  database_list="$(npx --yes wrangler@4 d1 list --json)"
  database_id="$(printf '%s' "$database_list" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const db=JSON.parse(s).find(d=>d.name==="photoswiper-sync");if(!db)process.exit(1);process.stdout.write(db.uuid||db.id);});')"
fi
config_path="$(mktemp "$repository_root/worker/.wrangler-deploy-XXXXXX.toml")"
trap 'rm -f "$config_path"' EXIT
sed "s/REPLACE_DATABASE_ID/$database_id/g" wrangler.toml > "$config_path"
npx --yes wrangler@4 d1 migrations apply photoswiper-sync --remote --config "$config_path"
if [[ -n "${SYNC_TOKEN:-}" ]]; then
  printf '%s' "$SYNC_TOKEN" | npx --yes wrangler@4 secret put SYNC_TOKEN --config "$config_path"
fi
if [[ -n "${PAIRING_IP_KEY:-}" ]]; then
  printf '%s' "$PAIRING_IP_KEY" | npx --yes wrangler@4 secret put PAIRING_IP_KEY --config "$config_path"
fi
if ! secret_list="$(npx --yes wrangler@4 secret list --config "$config_path")"; then
  printf '%s\n' "Deployment blocked: could not verify PAIRING_IP_KEY on the Worker. Supply it before deploying; see docs/sync.md." >&2
  exit 1
fi
if [[ -z "${PAIRING_IP_KEY:-}" ]] && ! printf '%s' "$secret_list" | node -e 'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>process.exit(JSON.parse(input).some(secret=>secret.name==="PAIRING_IP_KEY")?0:1));'; then
  printf '%s\n' "Deployment blocked: PAIRING_IP_KEY is missing from the Worker. Supply it before deploying; see docs/sync.md." >&2
  exit 1
fi
npx --yes wrangler@4 deploy --config "$config_path"
