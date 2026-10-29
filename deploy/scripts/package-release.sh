#!/usr/bin/env bash
# Build the release bundle that remote-deploy.sh installs on the server.
# Run from the repository root AFTER `npm run build --prefix frontend`.
#   bash deploy/scripts/package-release.sh <git-sha> <out-dir>
# Produces <out-dir>/kadak-<sha12>.tar.gz and <out-dir>/remote-deploy.sh.
#
# The bundle holds replaceable application files only. It never contains:
#   backend/.env, backend/uploads, backend/local.db, node_modules, or
#   frontend/dist/config.js (the server keeps its own in shared/config.js).
set -euo pipefail

sha="${1:?usage: package-release.sh <git-sha> <out-dir>}"
out="${2:?usage: package-release.sh <git-sha> <out-dir>}"
id="${sha:0:12}"

[ -f frontend/dist/index.html ] || { echo "::error::frontend/dist is missing — build the frontend first"; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/backend" "$stage/frontend" "$stage/deploy" "$out"

cp -R backend/src backend/db backend/package.json backend/package-lock.json "$stage/backend/"
cp -R frontend/dist "$stage/frontend/dist"
rm -f "$stage/frontend/dist/config.js"
cp -R deploy/scripts deploy/templates "$stage/deploy/"
printf 'release=%s\nsha=%s\nbuilt=%s\n' "$id" "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage/RELEASE"

tar -C "$stage" -czf "$out/kadak-$id.tar.gz" .
cp deploy/scripts/remote-deploy.sh "$out/remote-deploy.sh"
echo "✓ $out/kadak-$id.tar.gz ($(du -h "$out/kadak-$id.tar.gz" | cut -f1))"
