#!/usr/bin/env bash
# Repository hygiene checks that need no network or credentials:
#  - no .env files, databases, uploads or private keys are tracked by git
#  - .env.example files hold placeholders only
#  - required pipeline/deployment files exist
# Usage: bash scripts/ci/check-repo-safety.sh   (from the repository root)
set -euo pipefail

fail=0
err() { echo "::error::$*"; fail=1; }

tracked="$(git ls-files)"

# 1. Files that must never be committed.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.env.example) ;;
    .env|*/.env|.env.*|*/.env.*) err "environment file is tracked: $f" ;;
    *.db|*.sqlite|*.sqlite3) err "database file is tracked: $f" ;;
    backend/uploads/*) err "uploaded image is tracked: $f" ;;
    *.pem|*.key|*id_rsa*|*id_ed25519*) err "key-like file is tracked: $f" ;;
  esac
done <<< "$tracked"

# 2. Private key material anywhere in tracked text files.
if git grep -lI -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . >/dev/null 2>&1; then
  err "private key material found in: $(git grep -lI -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . | tr '\n' ' ')"
fi

# 3. .gitignore must keep secrets and persistent data out.
for pattern in '.env' 'backend/uploads/' 'backend/local.db'; do
  grep -qxF "$pattern" .gitignore || err ".gitignore is missing '$pattern'"
done

# 4. .env.example: placeholders only (the local-dev default kadak:kadak@localhost is allowed).
if [ -f backend/.env.example ]; then
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in
      DATABASE_URL)
        case "$val" in postgres://kadak:kadak@localhost:5432/kadak) ;; *) err "backend/.env.example DATABASE_URL must stay the local-dev placeholder" ;; esac ;;
      MANAGER_PASSWORD)
        [ "$val" = "change-me-please" ] || err "backend/.env.example MANAGER_PASSWORD must stay a placeholder" ;;
    esac
  done < backend/.env.example
fi

# 5. Files the pipeline and deployment depend on.
for f in \
  .github/workflows/ci.yml .github/workflows/deploy.yml \
  frontend/public/config.js frontend/src/runtimeConfig.js \
  backend/package-lock.json frontend/package-lock.json backend/db/schema.sql \
  deploy/nginx/kadak.conf.template deploy/systemd/kadak-backend.service \
  deploy/templates/backend.env.template deploy/templates/config.js.template \
  deploy/scripts/package-release.sh deploy/scripts/remote-deploy.sh deploy/scripts/rollback.sh \
  deploy/server/bootstrap.sh docs/AWS_DEPLOYMENT.md; do
  [ -f "$f" ] || err "required file missing: $f"
done

# 6. Deployment scripts must not run destructive database commands.
if grep -nE 'reseed-food|DROP (TABLE|DATABASE)|TRUNCATE|rm -rf[^#]*shared' deploy/scripts/*.sh; then
  err "deploy scripts reference destructive database or shared-data commands (see lines above)"
fi

# 7. CI must stay independent of AWS: no secrets or AWS_* settings in ci.yml.
if grep -nE 'secrets\.|AWS_' .github/workflows/ci.yml; then
  err "ci.yml must not reference secrets or AWS settings (see lines above)"
fi

[ "$fail" -eq 0 ] && echo "✓ repository safety checks passed"
exit "$fail"
