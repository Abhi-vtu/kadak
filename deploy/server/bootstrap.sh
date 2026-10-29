#!/usr/bin/env bash
# ONE-TIME server preparation for Kadak AirMenu on a fresh EC2 Linux instance.
# Run it yourself, ON the server, as root (sudo). It is never run by CI.
#
#   sudo bash bootstrap.sh --distro <ubuntu|amazon-linux-2023> \
#        --deploy-user <ssh-user-github-uses> --server-name <domain-or-public-ip> \
#        [--deploy-path /var/www/kadak] [--node-major 22] [--with-local-postgres]
#
# The distribution is an explicit choice (not guessed) and is checked against
# /etc/os-release. Supported: Ubuntu 22.04 / 24.04 LTS, Amazon Linux 2023.
#
# What it does (idempotent; it never overwrites existing backend.env,
# config.js, uploads or Nginx site config):
#   1. installs Nginx and Node.js (NodeSource repository, major --node-major)
#   2. creates the `kadak` system user that runs the backend
#   3. creates <deploy-path>/{releases,shared,shared/uploads,incoming}
#   4. writes shared/backend.env and shared/config.js from templates (if absent)
#   4b. with --with-local-postgres: installs PostgreSQL on THIS server (listening
#      on localhost only), creates role + database `kadak` with a random
#      password, and writes DATABASE_URL into backend.env (only while it still
#      holds the template placeholder — an existing DATABASE_URL is kept)
#   5. installs the systemd unit and the Nginx site
#   6. lets --deploy-user restart only the kadak-backend service via sudo
# It does NOT obtain TLS certificates or deploy the app.
set -euo pipefail

DISTRO="" DEPLOY_USER="" SERVER_NAME="" DEPLOY_PATH="/var/www/kadak" NODE_MAJOR="22" LOCAL_PG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --with-local-postgres) LOCAL_PG=1; shift ;;
    --distro) DISTRO="$2"; shift 2 ;;
    --deploy-user) DEPLOY_USER="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --deploy-path) DEPLOY_PATH="$2"; shift 2 ;;
    --node-major) NODE_MAJOR="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "[bootstrap] ERROR: $*" >&2; exit 1; }
log() { echo "[bootstrap] $*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash bootstrap.sh ...)"
[ -n "$DISTRO" ] || die "--distro is required: ubuntu or amazon-linux-2023"
[ -n "$DEPLOY_USER" ] || die "--deploy-user is required (the SSH user GitHub Actions logs in as)"
[ -n "$SERVER_NAME" ] || die "--server-name is required (domain, or the public IP until DNS exists)"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "user '$DEPLOY_USER' does not exist on this server"
case "$DEPLOY_PATH" in /*) ;; *) die "--deploy-path must be absolute" ;; esac
case "$DEPLOY_PATH" in *" "*|*/) die "--deploy-path must have no spaces or trailing slash" ;; esac

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # the deploy/ directory
for f in nginx/kadak.conf.template systemd/kadak-backend.service templates/backend.env.template templates/config.js.template; do
  [ -f "$SRC/$f" ] || die "missing $SRC/$f — copy the whole deploy/ directory to the server"
done

# ---- 1. verify distribution, install packages ----
# shellcheck disable=SC1091
. /etc/os-release
case "$DISTRO" in
  ubuntu)
    [ "${ID:-}" = "ubuntu" ] || die "--distro ubuntu but this server is '${PRETTY_NAME:-unknown}'"
    NGINX_USER="www-data"
    log "installing packages (apt)"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y nginx curl ca-certificates gnupg tar gzip
    if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
      log "installing Node.js $NODE_MAJOR from NodeSource"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
      bash /tmp/nodesource_setup.sh
      apt-get install -y nodejs
    fi
    # Disable the stock default site so this app answers on port 80 (the file stays in sites-available).
    rm -f /etc/nginx/sites-enabled/default
    ;;
  amazon-linux-2023)
    [ "${ID:-}" = "amzn" ] && [ "${VERSION_ID:-}" = "2023" ] || die "--distro amazon-linux-2023 but this server is '${PRETTY_NAME:-unknown}'"
    NGINX_USER="nginx"
    log "installing packages (dnf)"
    dnf install -y nginx tar gzip
    if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
      log "installing Node.js $NODE_MAJOR from NodeSource"
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
      bash /tmp/nodesource_setup.sh
      dnf install -y nodejs
    fi
    if command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
      log "SELinux enforcing: allowing Nginx to proxy to the backend"
      setsebool -P httpd_can_network_connect 1
    fi
    ;;
  *) die "unsupported --distro '$DISTRO' (use ubuntu or amazon-linux-2023)" ;;
esac
log "node $(node -v), npm $(npm -v), $(nginx -v 2>&1)"

# ---- 2. runtime user ----
if ! id kadak >/dev/null 2>&1; then
  log "creating system user kadak"
  useradd --system --home-dir "$DEPLOY_PATH" --no-create-home --shell /usr/sbin/nologin kadak
fi
# The deploy user may read backend.env (group kadak) so deployments can pre-check it.
usermod -aG kadak "$DEPLOY_USER"

# ---- 3. directories ----
log "creating $DEPLOY_PATH layout"
install -d -m 755 -o root -g root "$DEPLOY_PATH" "$DEPLOY_PATH/shared"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH/releases" "$DEPLOY_PATH/incoming"
install -d -m 755 -o kadak -g kadak "$DEPLOY_PATH/shared/uploads"
# current symlink and the deploy lock are written by the deploy user
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_PATH"

# ---- 4. shared files (never overwritten) ----
if [ ! -e "$DEPLOY_PATH/shared/backend.env" ]; then
  sed "s#__DEPLOY_PATH__#$DEPLOY_PATH#g" "$SRC/templates/backend.env.template" > "$DEPLOY_PATH/shared/backend.env"
  log "created shared/backend.env from template — EDIT IT before the first deployment"
else
  log "shared/backend.env exists — left unchanged"
fi
chown root:kadak "$DEPLOY_PATH/shared/backend.env"
chmod 640 "$DEPLOY_PATH/shared/backend.env"

if [ ! -e "$DEPLOY_PATH/shared/config.js" ]; then
  cp "$SRC/templates/config.js.template" "$DEPLOY_PATH/shared/config.js"
  log "created shared/config.js (API_BASE_URL \"\" = same origin via Nginx)"
else
  log "shared/config.js exists — left unchanged"
fi
chown root:root "$DEPLOY_PATH/shared/config.js"
chmod 644 "$DEPLOY_PATH/shared/config.js"

# ---- 4b. optional: PostgreSQL on this server ----
if [ "$LOCAL_PG" -eq 1 ]; then
  case "$DISTRO" in
    ubuntu)
      log "installing PostgreSQL (apt)"
      apt-get install -y postgresql
      systemctl enable --now postgresql
      ;;
    amazon-linux-2023)
      log "installing PostgreSQL 16 (dnf)"
      dnf install -y postgresql16-server
      if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then postgresql-setup --initdb; fi
      # AL2023 defaults TCP logins to "ident"; the backend logs in with a password.
      sed -i -E 's/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+(127\.0\.0\.1\/32|::1\/128)[[:space:]]+)ident/\1scram-sha-256/' \
        /var/lib/pgsql/data/pg_hba.conf
      systemctl enable --now postgresql
      systemctl reload postgresql
      ;;
  esac
  # Both distributions listen on localhost only by default — keep it that way,
  # and never open port 5432 in the security group.

  pg() { (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA "$@"); }
  env_file="$DEPLOY_PATH/shared/backend.env"
  if grep -qE '^DATABASE_URL=.*YOUR_' "$env_file"; then
    log "creating PostgreSQL role and database 'kadak' (password generated, stored only in backend.env)"
    pw="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"   # hex: safe in a URL, no escaping
    pg -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kadak') THEN CREATE ROLE kadak LOGIN; END IF; END \$\$;"
    printf "ALTER ROLE kadak WITH LOGIN PASSWORD '%s';\n" "$pw" | pg   # via stdin, not the process list
    if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = 'kadak'")" != "1" ]; then
      (cd /tmp && sudo -u postgres createdb -O kadak kadak)
    fi
    sed -i -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://kadak:$pw@127.0.0.1:5432/kadak#" \
           -e "s#^DATABASE_SSL=.*#DATABASE_SSL=false#" "$env_file"
    unset pw
    log "backend.env now points at the local database (DATABASE_SSL=false)"
  else
    log "backend.env already has a DATABASE_URL — left unchanged (role/database not modified)"
  fi
fi

# ---- 5. systemd + Nginx ----
log "installing systemd unit kadak-backend.service"
sed "s#__DEPLOY_PATH__#$DEPLOY_PATH#g" "$SRC/systemd/kadak-backend.service" > /etc/systemd/system/kadak-backend.service
systemctl daemon-reload
systemctl enable kadak-backend.service   # started by the first deployment

site=/etc/nginx/conf.d/kadak.conf
rendered="$(sed -e "s#__DEPLOY_PATH__#$DEPLOY_PATH#g" -e "s#__SERVER_NAME__#$SERVER_NAME#g" "$SRC/nginx/kadak.conf.template")"
if [ -e "$site" ]; then
  printf '%s\n' "$rendered" > "$site.new"
  log "$site exists (certbot may have edited it) — wrote $site.new for comparison instead"
else
  printf '%s\n' "$rendered" > "$site"
  log "installed $site"
fi
id "$NGINX_USER" >/dev/null 2>&1 || log "warning: expected Nginx user $NGINX_USER not found"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ---- 6. narrowly scoped sudo for the deploy user ----
sudoers=/etc/sudoers.d/kadak-deploy
cat > "$sudoers.tmp" <<EOF
# Kadak AirMenu: lets the GitHub Actions deploy user restart the backend and read its logs only.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart kadak-backend, /usr/bin/systemctl status kadak-backend, /usr/bin/journalctl -u kadak-backend -n 50 --no-pager
EOF
visudo -cf "$sudoers.tmp" >/dev/null || { rm -f "$sudoers.tmp"; die "generated sudoers file is invalid"; }
install -m 440 -o root -g root "$sudoers.tmp" "$sudoers"
rm -f "$sudoers.tmp"

cat <<EOF

[bootstrap] Done. Server prepared at $DEPLOY_PATH. Next (docs/AWS_DEPLOYMENT.md, Phase B):
  1. sudo nano $DEPLOY_PATH/shared/backend.env      # set MANAGER_PASSWORD (and DATABASE_URL unless --with-local-postgres filled it)
  2. Configure the GitHub secrets + set AWS_DEPLOY_ENABLED=true; the next green push to main deploys
  3. After the first deployment, create the schema + menu once: see "First-time database setup"
  4. After DNS points here: obtain a TLS certificate with certbot --nginx
EOF
