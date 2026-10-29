#!/usr/bin/env bash
# Runs ON the EC2 server (uploaded and invoked by .github/workflows/deploy.yml).
# Installs one release next to the previous ones, switches the `current`
# symlink atomically, restarts the backend and health-checks it. If the health
# check fails it switches back to the previous release and exits non-zero.
#
#   bash remote-deploy.sh --deploy-path /var/www/kadak --archive <tar.gz> --release-id <id>
#
# Layout (created by deploy/server/bootstrap.sh):
#   <deploy-path>/releases/<id>/   replaceable app files (one dir per release)
#   <deploy-path>/current          -> releases/<id>   (what systemd + Nginx use)
#   <deploy-path>/shared/backend.env   backend secrets      (never touched here)
#   <deploy-path>/shared/config.js     runtime frontend cfg (never touched here)
#   <deploy-path>/shared/uploads/      uploaded photos      (never touched here)
#   <deploy-path>/incoming/            upload drop for the workflow
#
# It never runs database seed/migration scripts and never deletes shared/.
set -euo pipefail

SERVICE="kadak-backend"
KEEP_RELEASES=5
DEPLOY_PATH="" ARCHIVE="" RELEASE_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-path) DEPLOY_PATH="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --release-id) RELEASE_ID="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

[ -n "$DEPLOY_PATH" ] && [ -n "$ARCHIVE" ] && [ -n "$RELEASE_ID" ] || die "--deploy-path, --archive and --release-id are required"
case "$RELEASE_ID" in *[!A-Za-z0-9._-]*) die "invalid release id: $RELEASE_ID" ;; esac

SHARED="$DEPLOY_PATH/shared"
RELEASES="$DEPLOY_PATH/releases"
CURRENT="$DEPLOY_PATH/current"

# ---- one deployment at a time ----
exec 9>"$DEPLOY_PATH/.deploy.lock"
flock -n 9 || die "another deployment is running"

# ---- preflight: fail before touching anything ----
log "preflight checks"
[ -f "$ARCHIVE" ] || die "release archive not found: $ARCHIVE"
for d in "$RELEASES" "$SHARED" "$SHARED/uploads"; do [ -d "$d" ] || die "$d missing — run deploy/server/bootstrap.sh first"; done
[ -e "$SHARED/backend.env" ] || die "$SHARED/backend.env missing — create it from deploy/templates/backend.env.template"
[ -f "$SHARED/config.js" ] || die "$SHARED/config.js missing — create it from deploy/templates/config.js.template"
if [ -r "$SHARED/backend.env" ]; then
  for key in DATABASE_URL MANAGER_PASSWORD UPLOAD_DIR; do
    grep -qE "^${key}=.+" "$SHARED/backend.env" || die "backend.env: $key is not set"
  done
  if grep -qE '^[A-Z_]+=.*YOUR_' "$SHARED/backend.env"; then die "backend.env still contains YOUR_... placeholders"; fi
  grep -qE "^UPLOAD_DIR=$SHARED/uploads/?$" "$SHARED/backend.env" \
    || die "backend.env: UPLOAD_DIR must be $SHARED/uploads so photos survive deployments"
else
  log "warning: cannot read backend.env as $(id -un); skipping its content checks"
fi
command -v node >/dev/null || die "node is not installed"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "Node.js 20+ required (found $(node -v))"
# Same core rules the browser applies (frontend/src/runtimeConfig.js).
node -e '
  const vm = require("vm"), fs = require("fs"), s = { window: {} };
  vm.runInNewContext(fs.readFileSync(process.argv[1], "utf8"), s, { timeout: 1000 });
  const v = s.window.APP_CONFIG && s.window.APP_CONFIG.API_BASE_URL;
  if (typeof v !== "string") throw new Error("APP_CONFIG.API_BASE_URL must be a string");
  if (/YOUR_|[<>{}]/.test(v)) throw new Error("API_BASE_URL still contains a placeholder: " + v);
  if (v.trim() && !/^https?:\/\/[^\s?#]+$/.test(v.trim())) throw new Error("API_BASE_URL must be \"\" or an http(s) URL: " + v);
' "$SHARED/config.js" || die "shared/config.js is invalid (see error above)"

PORT="$(sed -n 's/^PORT=//p' "$SHARED/backend.env" 2>/dev/null | tail -n1)"
HEALTH_URL="http://127.0.0.1:${PORT:-4000}/api/health"

# ---- unpack the release ----
target="$RELEASES/$RELEASE_ID"
[ -e "$target" ] && target="$target-$(date +%Y%m%d%H%M%S)"
staging="$target.partial"
rm -rf "$staging"
mkdir -p "$staging"
log "unpacking into $target"
tar -xzf "$ARCHIVE" -C "$staging"
[ -f "$staging/backend/src/server.js" ] && [ -f "$staging/frontend/dist/index.html" ] || die "archive is missing backend/src/server.js or frontend/dist/index.html"

log "installing backend dependencies (npm ci --omit=dev)"
( cd "$staging/backend" && npm ci --omit=dev --no-audit --no-fund ) || { rm -rf "$staging"; die "npm ci failed — current release left running"; }

# The deployed /config.js is the server's own copy, so editing it never needs a rebuild.
ln -sfn "$SHARED/config.js" "$staging/frontend/dist/config.js"
mv "$staging" "$target"

# ---- switch and restart ----
previous="$(readlink -f "$CURRENT" 2>/dev/null || true)"
switch_to() { ln -sfn "$1" "$CURRENT.next" && mv -Tf "$CURRENT.next" "$CURRENT"; }

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

log "activating $target"
switch_to "$target"
sudo -n /usr/bin/systemctl restart "$SERVICE"

if healthy; then
  log "health check passed: $HEALTH_URL"
else
  log "health check FAILED: $HEALTH_URL"
  sudo -n /usr/bin/journalctl -u "$SERVICE" -n 50 --no-pager 2>/dev/null || true
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    log "rolling back to $previous"
    switch_to "$previous"
    sudo -n /usr/bin/systemctl restart "$SERVICE"
    if healthy; then log "rollback healthy"; else log "rollback ALSO unhealthy — check backend.env / database"; fi
  else
    log "no previous release to roll back to"
  fi
  die "deployment of $RELEASE_ID failed"
fi

# ---- tidy up: keep the newest releases, plus current and previous ----
rm -f "$ARCHIVE"
keep_cur="$(readlink -f "$CURRENT")"
# shellcheck disable=SC2012  # release dir names are [A-Za-z0-9._-] only
ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  if [ "$old" = "$keep_cur" ] || [ "$old" = "$previous" ]; then continue; fi
  log "removing old release $old"
  rm -rf -- "$old"
done

log "deployed $(sed -n 's/^sha=//p' "$CURRENT/RELEASE") as $(basename "$keep_cur")"
