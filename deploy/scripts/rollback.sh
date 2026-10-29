#!/usr/bin/env bash
# Manual rollback ON the EC2 server: point `current` at an earlier release,
# restart the backend and health-check it. Uploaded photos, backend.env,
# config.js and the database are not touched.
#
#   bash rollback.sh [--deploy-path /var/www/kadak] [--to <release-dir-name>] [--list]
# Without --to, rolls back to the newest release older than the current one.
set -euo pipefail

SERVICE="kadak-backend"
DEPLOY_PATH="/var/www/kadak"
TO=""
LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-path) DEPLOY_PATH="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RELEASES="$DEPLOY_PATH/releases"
CURRENT="$DEPLOY_PATH/current"
cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"

# Newest first.
# shellcheck disable=SC2012  # release dir names are [A-Za-z0-9._-] only
mapfile -t all < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##')
[ "${#all[@]}" -gt 0 ] || { echo "no releases in $RELEASES" >&2; exit 1; }

if [ "$LIST" -eq 1 ]; then
  for r in "${all[@]}"; do
    mark=" "; [ "$r" = "$cur" ] && mark="*"
    echo "$mark $(basename "$r")  $(sed -n 's/^built=//p' "$r/RELEASE" 2>/dev/null)"
  done
  exit 0
fi

if [ -n "$TO" ]; then
  target="$RELEASES/$TO"
else
  target=""
  seen=0
  for r in "${all[@]}"; do
    if [ "$seen" -eq 1 ]; then target="$r"; break; fi
    [ "$r" = "$cur" ] && seen=1
  done
fi
[ -n "$target" ] && [ -d "$target" ] || { echo "no release to roll back to (use --list, then --to <name>)" >&2; exit 1; }
[ "$target" != "$cur" ] || { echo "$target is already current" >&2; exit 1; }

PORT="$(sed -n 's/^PORT=//p' "$DEPLOY_PATH/shared/backend.env" 2>/dev/null | tail -n1)"
HEALTH_URL="http://127.0.0.1:${PORT:-4000}/api/health"

echo "[rollback] $(basename "$cur") -> $(basename "$target")"
ln -sfn "$target" "$CURRENT.next" && mv -Tf "$CURRENT.next" "$CURRENT"
sudo -n /usr/bin/systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then echo "[rollback] healthy: $HEALTH_URL"; exit 0; fi
  sleep 2
done
echo "[rollback] backend is NOT healthy after rollback — check: sudo journalctl -u $SERVICE -n 100" >&2
exit 1
