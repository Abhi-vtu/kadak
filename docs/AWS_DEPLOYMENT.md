# Kadak AirMenu — CI/CD and AWS Deployment

This project is deployed in two phases:

| Phase | Status | Needs AWS? |
|---|---|---|
| **A — CI pipeline** | Active now. Every push and PR to `main` is built and checked. | No |
| **B — AWS EC2 deployment** | Prepared but **switched off**. You activate it once a server exists. | Yes |

Steps marked **⛔ needs AWS** can't be done until the EC2 instance (and, for HTTPS, a domain) exists.

---

## Target architecture (Phase B)

```
Browser ──HTTPS──▶ Nginx (EC2, ports 80/443)
                    ├─ /             → <deploy>/current/frontend/dist   (static React build)
                    ├─ /config.js    → <deploy>/shared/config.js        (runtime config, no-store)
                    ├─ /uploads/     → <deploy>/shared/uploads/         (persistent photos)
                    └─ /api/         → 127.0.0.1:4000  Node/Express (systemd: kadak-backend)
                                                         │
                                                         └──▶ PostgreSQL (RDS or local, private)
```

Directory layout on the server (default `<deploy>` = `/var/www/kadak`):

```
/var/www/kadak/
├── current -> releases/<sha>      # switched atomically on each deploy
├── releases/<sha>/                # replaceable: backend/, frontend/dist/, deploy/, RELEASE
├── incoming/                      # upload drop for the deploy workflow
└── shared/                        # PERSISTENT — never touched by deployments
    ├── backend.env                # DATABASE_URL, MANAGER_PASSWORD, ... (root:kadak 640)
    ├── config.js                  # runtime frontend config (edit to change API address)
    └── uploads/                   # uploaded food photos (owned by kadak)
```

Deployments replace only `releases/` and `current`. They never run a database seed or migration and never touch `shared/`.

---

# Phase A — CI pipeline (current phase)

## Files created and changed

**Created**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | CI: runs on push/PR to `main`. No AWS. |
| `.github/workflows/deploy.yml` | Manual AWS deployment, guarded (inactive until Phase B). |
| `.nvmrc` | Node.js major version (22) used by CI and the deploy build. |
| `.gitattributes` | Keeps LF line endings for shell scripts, unit and templates (they run on Linux). |
| `frontend/public/config.js` | Runtime frontend config (`window.APP_CONFIG`). Copied unbundled into `dist/`. |
| `frontend/src/runtimeConfig.js` | Reads and validates `window.APP_CONFIG`, exports `API_BASE_URL` and `backendUrl()`. |
| `scripts/ci/check-runtime-config.mjs` | Validates a `config.js` file with the same rules the browser uses. |
| `scripts/ci/check-frontend-dist.mjs` | Verifies `dist/` loads `/config.js` before the bundle and has no hardcoded backend address. |
| `scripts/ci/check-repo-safety.sh` | No `.env`, databases, uploads or keys tracked. Required files present. CI has no AWS references. |
| `scripts/ci/run-optional-scripts.sh` | Runs `lint`/`test` npm scripts **if they exist**. Otherwise reports "not configured". |
| `scripts/ci/smoke-test.sh` | Seeds a throwaway PostgreSQL, starts the backend, checks health/menu/auth/config.js. |
| `deploy/nginx/kadak.conf.template` | Nginx site: static frontend, `/api` proxy, `/uploads`, cache rules. |
| `deploy/systemd/kadak-backend.service` | systemd unit for the backend (restart on failure, journald logs, hardened). |
| `deploy/templates/backend.env.template` | Production backend env template (placeholders only). |
| `deploy/templates/config.js.template` | Production runtime config template. |
| `deploy/server/bootstrap.sh` | One-time server setup for **Ubuntu** or **Amazon Linux 2023** (explicit choice). |
| `deploy/scripts/package-release.sh` | Builds the release tarball (CI side). |
| `deploy/scripts/remote-deploy.sh` | Installs a release on the server, health-checks, auto-rolls back. |
| `deploy/scripts/rollback.sh` | Manual rollback to an earlier release on the server. |
| `docs/AWS_DEPLOYMENT.md` | This document. |

**Changed**

| File | Change |
|---|---|
| `frontend/index.html` | Loads `/config.js` (classic blocking script) before the app bundle. |
| `frontend/src/api.js` | API base comes from runtime config instead of build-time `VITE_API_BASE`. |
| `frontend/src/main.jsx` | Shows a clear error page if `config.js` is missing or invalid. |
| `frontend/src/components/Visual.jsx`, `frontend/src/pages/Manager.jsx` | Photo `<img>` URLs resolve against the runtime API base. |
| `frontend/.env.example` | Says the frontend no longer has build-time variables. |
| `backend/src/server.js` | Serves `config.js` and `index.html` with `Cache-Control: no-store`. |
| `README.md` | Points to this document. |

## How the CI workflow runs

`ci.yml` triggers on every **push to `main`**, every **pull request targeting `main`**, and on manual "Run workflow". It has three jobs:

1. **Frontend** — `npm ci` (from `frontend/package-lock.json`). Runs `lint`/`test` only if defined; today neither exists, so the log shows a notice saying they were *skipped, nothing was run*. Then `npm run build` (Vite), validation of `frontend/public/config.js`, and a check of the built `dist/` (config loaded first, no hardcoded backend). Uploads `dist/` as an artifact.
2. **Backend** — `npm ci` (from `backend/package-lock.json`), `node --check` on every backend file, optional `lint`/`test`, then **a real smoke test** against a throwaway `postgres:16` service container. It runs `npm run seed` and starts `node src/server.js` with the built frontend. Then it checks `/api/health`, `/api/menu` (menu has categories), manager login (wrong → 401, right → 200), unauthenticated manager API → 401, `/uploads/` 404, `/` and `/config.js` (with `Cache-Control: no-store`).
3. **Deployment config & repository safety** — repo hygiene (no secrets, `.env`, `*.db`, uploads or keys tracked; `.env.example` placeholders; required files; no destructive DB commands in deploy scripts; `ci.yml` has no secrets/AWS references). Also validates the production `config.js` template, runs ShellCheck on all shell scripts, checks the systemd unit's directives, runs `nginx -t` on the rendered Nginx template (in an `nginx` container), and runs `actionlint` on both workflows.

The CI database password (`kadak_ci_only`) and manager password are throwaway values for a container that exists only during the run. They aren't real credentials.

## How to trigger and inspect a run

- **Automatically:** push a commit to `main`, or open a PR into `main`.
- **Manually:** GitHub → **Actions** → **CI** → **Run workflow** → branch `main`.
- **Inspect:** Actions tab → click the run → each job → expand a step to see its log. A failure is shown as a red ✗ on the step, with `::error::` lines highlighted at the top of the run summary.
- With the GitHub CLI: `gh run list --workflow ci.yml` then `gh run view <id> --log-failed`.

## How runtime `config.js` works

- `frontend/public/config.js` sets `window.APP_CONFIG = { API_BASE_URL: "" }`.
- Vite copies `public/` to `dist/` **without bundling or hashing**, so `dist/config.js` stays a plain, editable file.
- `index.html` loads `<script src="/config.js">` in `<head>` as a classic blocking script. The app bundle is a module script, which the browser defers until parsing finishes, so `window.APP_CONFIG` always exists before the app runs.
- `frontend/src/runtimeConfig.js` validates it. It accepts `""` (same origin) or an absolute `http(s)://host[:port][/prefix]` URL with no query or fragment, and normalizes it by stripping any trailing slash. It rejects `YOUR_…` placeholders, `http://` APIs on an `https://` page, and `localhost` APIs when the site isn't on localhost.
- **If invalid or missing in production, the app renders an error page** ("Menu is temporarily unavailable … /config.js is missing or invalid") and logs the reason to the console. In `npm run dev` only, a missing file falls back to same-origin with a console warning.
- All API calls go through `api.js` (`API_BASE_URL + '/api/...'`). Stored photo URLs stay relative (`/uploads/<uuid>.webp`) in the database. The UI resolves them for display with `backendUrl()`, so the manager still sends the original relative value back and the backend's photo-cleanup logic keeps working.
- Caching: Express and Nginx both send `Cache-Control: no-store` for `/config.js` and `index.html`. A browser therefore picks up an edited config on its next page load. Hashed `/assets/*` files are cached for a year.

**Never put passwords, database URLs, keys or tokens in `config.js`** — anyone can download it.

## Validate the frontend configuration locally

```bash
node scripts/ci/check-runtime-config.mjs frontend/public/config.js
node scripts/ci/check-runtime-config.mjs deploy/templates/config.js.template
```

To see the runtime behaviour in a real browser, build and serve the frontend with the backend:

```bash
npm --prefix frontend run build
npm --prefix backend start
```

Open http://localhost:4000 and check DevTools → Network: `/config.js` loads first with `Cache-Control: no-store`, and `/api/menu` is requested.
Then edit `frontend/dist/config.js` (for example `API_BASE_URL: "YOUR_TEST"`) and reload the page. The error page appears without any rebuild. Put the value back afterwards. `dist/` is regenerated by every build anyway.

## Test the frontend build and backend checks locally

```bash
npm ci --prefix frontend
npm ci --prefix backend
npm run build --prefix frontend
node scripts/ci/check-frontend-dist.mjs frontend/dist
bash scripts/ci/check-repo-safety.sh
```

Backend smoke test (needs a local PostgreSQL and a **throwaway** database — it seeds it):

```bash
DATABASE_URL=postgres://kadak:kadak@localhost:5432/kadak_smoke MANAGER_PASSWORD=local-test bash scripts/ci/smoke-test.sh
```

On Windows, run the `.sh` scripts from **Git Bash**.

## Commit and push the pipeline files

In VS Code: Source Control panel → review the changes → enter a message → **Commit** → **Sync/Push**. Or from a terminal:

```bash
git add .gitattributes .github .nvmrc deploy docs scripts frontend backend/src/server.js README.md
git status
git commit -m "Add CI pipeline, runtime frontend config and AWS-ready deployment scripts"
git push origin main
```

Then open GitHub → **Actions** and watch the **CI** run. The deploy workflow does **not** run on push.

---

# Phase B — AWS deployment activation (future)

Nothing below has been done yet. Every step needs real infrastructure.

## 1. Choose and provision the EC2 server ⛔ needs AWS

- **Supported distributions** (pick one; the bootstrap script requires you to name it):
  - **Ubuntu Server 22.04 LTS or 24.04 LTS** — `--distro ubuntu` (SSH user usually `ubuntu`, Nginx user `www-data`)
  - **Amazon Linux 2023** — `--distro amazon-linux-2023` (SSH user usually `ec2-user`, Nginx user `nginx`, SELinux handled)
- Instance size: `t3.small` (2 GB RAM) is comfortable. `t3.micro` works but `npm ci` with `sharp` is slow. Use 20 GB+ gp3 storage, since photos are stored on this disk.
- Attach an **Elastic IP** so the address survives stop/start.
- Create or choose an **EC2 key pair** for your own admin SSH access.

## 2. Security group ⛔ needs AWS

| Port | Source | Why |
|---|---|---|
| 22 (SSH) | Your IP, and GitHub Actions (see note) | Admin + deployments |
| 80 (HTTP) | 0.0.0.0/0, ::/0 | HTTP → HTTPS redirect, certbot challenge |
| 443 (HTTPS) | 0.0.0.0/0, ::/0 | The site |
| 4000 | **do not open** | Backend is reached only through Nginx |
| 5432 | **do not open publicly** | PostgreSQL stays private |

GitHub-hosted runners use many changing IP ranges. Options: allow 22 from `0.0.0.0/0` with key-only auth (password login is disabled by default on both AMIs). Or use a self-hosted runner. Or restrict to the ranges published at `https://api.github.com/meta` (key `actions`) and keep them updated. This is an outstanding decision.

## 3. Node.js, Nginx, directories, service ⛔ needs AWS

Copy the `deploy/` directory to the server and run the bootstrap **once**:

```bash
scp -r deploy <admin-user>@<elastic-ip>:~/kadak-deploy
ssh <admin-user>@<elastic-ip>
sudo bash ~/kadak-deploy/server/bootstrap.sh --distro ubuntu --deploy-user ubuntu --server-name <domain-or-elastic-ip>
```

Replace `--distro ubuntu --deploy-user ubuntu` with `--distro amazon-linux-2023 --deploy-user ec2-user` on Amazon Linux. You can also create a dedicated `deploy` user and pass that.

It installs Nginx and Node.js 22 (NodeSource), creates the `kadak` runtime user and the `/var/www/kadak` layout, writes `shared/backend.env` + `shared/config.js` from templates (only if missing), installs the systemd unit and Nginx site, and lets the deploy user restart only `kadak-backend` via sudo. It does **not** install PostgreSQL, request certificates or deploy code.

## 4. PostgreSQL connectivity ⛔ needs AWS

Pick one (outstanding decision):

- **Amazon RDS for PostgreSQL (recommended):** private subnet, *Public access: No*. Its security group allows 5432 **only from the EC2 instance's security group**. In `backend.env`: `DATABASE_URL=postgres://<user>:<password>@<rds-endpoint>:5432/<db>` and `DATABASE_SSL=true`. (The backend uses TLS without CA verification — `rejectUnauthorized: false` in `backend/src/db.js`.)
- **PostgreSQL on the same EC2 instance:** install from the distro (`apt install postgresql` / `dnf install postgresql16-server` then `postgresql-setup --initdb`). Keep it listening on localhost only and set `DATABASE_SSL=false`. Back up both the database and `shared/uploads` together.

Edit the server's env file (never commit it):

```bash
sudo nano /var/www/kadak/shared/backend.env
```

Deployments refuse to run while any `YOUR_…` placeholder remains. They also refuse if `UPLOAD_DIR` isn't `<deploy>/shared/uploads`.

`backend/local.db` is an old **SQLite development file**. The current backend doesn't use it; it is git-ignored and never shipped in a release. Production uses only `DATABASE_URL`.

### First-time database setup (run once, by hand) ⛔ needs AWS

`npm run seed` (`backend/db/seed.js`) is **non-destructive**. It creates tables with `CREATE TABLE IF NOT EXISTS` and loads the menu **only if `menu_items` is empty**. Run it after the first deployment:

```bash
cd /var/www/kadak/current/backend
sudo -u kadak env DOTENV_CONFIG_PATH=/var/www/kadak/shared/backend.env node db/seed.js
```

**Never run `reseed-food` in production unless you intend to replace every food category and item.** It deletes all food categories and items. Deployments never run it, and CI fails if a deploy script references it.

**Schema changes later:** this project has no migration tool. `schema.sql` only creates missing tables and does not alter existing ones. For a future schema change, write a separate SQL file (e.g. `backend/db/migrations/002-*.sql`), back up the database, and apply it by hand with `psql` *before* deploying code that needs it.

## 5. Persistent image storage ⛔ needs AWS

Photos are saved by the backend to `UPLOAD_DIR=/var/www/kadak/shared/uploads` and served by Nginx at `/uploads/`. That directory sits outside `releases/`, so it survives every deployment and rollback. Back it up (e.g. nightly `aws s3 sync /var/www/kadak/shared/uploads s3://<bucket>/uploads`, or EBS snapshots) together with the database.

To copy existing local photos up: `scp backend/uploads/*.webp <user>@<host>:/tmp/` then `sudo install -o kadak -g kadak -m 644 /tmp/*.webp /var/www/kadak/shared/uploads/`.

## 6. SSH key for GitHub Actions ⛔ needs AWS

Create a **dedicated** key pair for deployments (not your personal key), on your own computer:

```bash
ssh-keygen -t ed25519 -C "github-actions-kadak-deploy" -f kadak_deploy -N ""
```

- Append `kadak_deploy.pub` to `~/.ssh/authorized_keys` of the deploy user on the server.
- The private file `kadak_deploy` becomes the `AWS_SSH_PRIVATE_KEY` secret. Delete the local copy once it's stored.
- Get the server's host key for `AWS_SSH_KNOWN_HOSTS`, and compare it with the fingerprint in the EC2 console's system log (or with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server):

  ```bash
  ssh-keyscan -t ed25519 <elastic-ip-or-domain>
  ```

## 7. GitHub Actions secrets and variables ⛔ needs AWS

GitHub → repo → **Settings → Environments → New environment** → `production`. Optionally add *Required reviewers* so each deployment needs an approval, and restrict *Deployment branches* to `main`. Then add these **environment secrets**:

| Secret | Value |
|---|---|
| `AWS_HOST` | Elastic IP or DNS name of the server |
| `AWS_USER` | Deploy SSH user (`ubuntu`, `ec2-user`, or your `deploy` user) |
| `AWS_SSH_PRIVATE_KEY` | Full contents of the `kadak_deploy` private key file |
| `AWS_SSH_KNOWN_HOSTS` | The `ssh-keyscan` line from step 6 (pins the host key — no blind trust) |
| `AWS_DEPLOY_PATH` | `/var/www/kadak` (or the `--deploy-path` you used) |

And these **variables** (Settings → Secrets and variables → Actions → *Variables*, or on the `production` environment):

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ENABLED` | `true` — the master switch. Leave unset/`false` to keep deployments off. |
| `APP_PUBLIC_URL` | Optional, e.g. `https://menu.example.com` — enables a public health check after deploy. |

Database credentials and the manager password are **not** GitHub secrets. They live only in `shared/backend.env` on the server.

With the GitHub CLI:

```bash
gh secret set AWS_SSH_PRIVATE_KEY --env production < kadak_deploy
gh secret set AWS_SSH_KNOWN_HOSTS --env production --body "$(ssh-keyscan -t ed25519 <host>)"
gh secret set AWS_HOST --env production --body "<host>"
gh secret set AWS_USER --env production --body "<user>"
gh secret set AWS_DEPLOY_PATH --env production --body "/var/www/kadak"
gh variable set AWS_DEPLOY_ENABLED --body "true"
```

## 8. Domain and HTTPS ⛔ needs AWS + domain

1. Create a DNS **A record** for your domain → the Elastic IP.
2. If you bootstrapped with the IP as `--server-name`, edit `server_name` in `/etc/nginx/conf.d/kadak.conf` to the domain, then `sudo nginx -t && sudo systemctl reload nginx`.
3. Install certbot and obtain a certificate (certbot edits the Nginx site to add TLS and an HTTP→HTTPS redirect, and installs auto-renewal):
   - Ubuntu: `sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot`
   - Amazon Linux 2023: `sudo dnf install -y python3 augeas-libs && sudo python3 -m venv /opt/certbot && sudo /opt/certbot/bin/pip install certbot certbot-nginx && sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot`. Add a renewal cron or timer: `echo "0 3 * * * root /opt/certbot/bin/certbot renew -q" | sudo tee /etc/cron.d/certbot`.
   - Then: `sudo certbot --nginx -d <domain>`
4. Keep `shared/config.js` at `API_BASE_URL: ""` (same origin). If you set an absolute URL it must be `https://`.

## 9. Enable the deployment workflow safely

The guard in `deploy.yml` refuses to deploy (the run **fails**, listing what's missing) unless all of these hold:

1. The run is on `main`.
2. Variable `AWS_DEPLOY_ENABLED` is `true`.
3. All five `production` secrets are set.
4. For manual runs, the confirm box contains exactly `deploy`.

**Automatic deploy after CI (optional, later):** in `.github/workflows/deploy.yml`, uncomment the `workflow_run:` block. From then on, every push to `main` that passes CI deploys. Turn it off instantly by setting `AWS_DEPLOY_ENABLED` to `false`.

## 10. First deployment ⛔ needs AWS

1. Server bootstrapped, `backend.env` filled in, database reachable.
2. GitHub → **Actions → Deploy (AWS EC2) → Run workflow** → branch `main` → type `deploy` → Run.
3. Jobs: **guard** (config check) → **build** (frontend build + release tarball) → **deploy**. The deploy job uploads the release, runs `remote-deploy.sh`, and health-checks `http://127.0.0.1:4000/api/health` on the server (that endpoint queries the DB).
4. Seed the database once (step 4, *First-time database setup*), then open the site and `/manager`.

## 11. Subsequent deployments

- With the manual workflow: run it again, the same way, each time.
- With `workflow_run` enabled: push to `main`. CI runs, and if it succeeds the deploy runs.

Each deploy:

1. Unpacks to `releases/<sha>`.
2. Runs `npm ci --omit=dev` on the server, so `sharp` gets the correct Linux binary.
3. Links `dist/config.js` → `shared/config.js`.
4. Atomically switches `current`, restarts `kadak-backend` and health-checks it.
5. Keeps the 5 newest releases.

## 12. Change the server address without rebuilding

```bash
ssh <user>@<host>
sudo nano /var/www/kadak/shared/config.js       # change API_BASE_URL only
node -e 'const vm=require("vm"),s={window:{}};vm.runInNewContext(require("fs").readFileSync("/var/www/kadak/shared/config.js","utf8"),s);console.log(s.window.APP_CONFIG)'
curl -sI https://<domain>/config.js | grep -i cache-control   # expect no-store
```

No rebuild, redeploy or restart is needed. `config.js` is served with `no-store`, so users get the new value on their next page load. Deployments never overwrite this file. Usually you change the *DNS record* for the domain instead and leave `API_BASE_URL: ""`. Edit `config.js` only if the API moves to a **different host** than the site.

## 13. Troubleshooting

| Symptom | Where to look |
|---|---|
| Guard job fails | The run summary lists exactly what is missing (variable, secret, confirm, branch). |
| `Permission denied (publickey)` / `Host key verification failed` | `AWS_SSH_PRIVATE_KEY` vs `authorized_keys`; re-run `ssh-keyscan` for `AWS_SSH_KNOWN_HOSTS` (it changes if the instance is replaced). SSH port open to the runner? |
| Preflight error from `remote-deploy.sh` | It names the file/setting: missing `backend.env`, `YOUR_` placeholder, wrong `UPLOAD_DIR`, invalid `config.js`, Node < 20. |
| Health check failed (auto-rolled back) | `sudo journalctl -u kadak-backend -n 100` — usually `DATABASE_URL`, `DATABASE_SSL`, or RDS security group. |
| Site shows "Menu is temporarily unavailable" | `shared/config.js` invalid — the page shows the exact reason. |
| 502 Bad Gateway | Backend down: `sudo systemctl status kadak-backend`. On AL2023 with SELinux: `getsebool httpd_can_network_connect`. |
| Photos 404 | Files in `/var/www/kadak/shared/uploads`? Readable by Nginx (`ls -l`)? |
| Upload fails "413" | `client_max_body_size` in the Nginx site. |

Logs: backend `journalctl -u kadak-backend -f`; Nginx `/var/log/nginx/kadak.access.log` and `kadak.error.log`.

## 14. Rollback

A failed health check rolls back automatically. To roll back by hand:

```bash
bash /var/www/kadak/current/deploy/scripts/rollback.sh --list
bash /var/www/kadak/current/deploy/scripts/rollback.sh               # to the previous release
bash /var/www/kadak/current/deploy/scripts/rollback.sh --to <name>   # to a specific one
```

Rollback swaps only the code. Photos, `backend.env`, `config.js` and the database are unchanged. If a release included a manual DB schema change, check that the older code still works with it before rolling back.

---

## Outstanding AWS decisions and values

- [ ] Linux distribution: Ubuntu 22.04/24.04 **or** Amazon Linux 2023
- [ ] AWS region, instance type, disk size; Elastic IP
- [ ] Deploy SSH user (`ubuntu` / `ec2-user` / dedicated `deploy`)
- [ ] How port 22 is reachable from GitHub Actions (open + key-only, GitHub IP ranges, or self-hosted runner)
- [ ] PostgreSQL: Amazon RDS **or** local on EC2; DB name, user, password; `DATABASE_SSL`
- [ ] Domain name and DNS provider; certbot for TLS
- [ ] Backups for the database and `shared/uploads` (snapshots / S3)
- [ ] Manual-only deploys, or automatic after CI (`workflow_run`); required reviewers on `production`
- [ ] Values for `AWS_HOST`, `AWS_USER`, `AWS_SSH_PRIVATE_KEY`, `AWS_SSH_KNOWN_HOSTS`, `AWS_DEPLOY_PATH`, `AWS_DEPLOY_ENABLED`, `APP_PUBLIC_URL`
- [ ] Whether to retire `render.yaml` (it still describes an older Turso/Cloudinary setup the code no longer uses)
