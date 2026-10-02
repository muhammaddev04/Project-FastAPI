# TezFarmo production deployment

Everything needed to deploy is in this repository: [docker-compose.prod.yml](../docker-compose.prod.yml),
[backend/Dockerfile](../backend/Dockerfile), [frontend/Dockerfile](../frontend/Dockerfile), the deployment
script [infra/deploy/remote-deploy.sh](../infra/deploy/remote-deploy.sh) and the workflow
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml). The only things that are **not** in Git are
the three files holding credentials; they are created once on the server (see
[One-time server setup](#one-time-server-setup)).

## Architecture

| | |
| --- | --- |
| Server | `37.27.245.216`, user `dev` |
| Project directory | `/home/dev/Project-FastAPI` |
| Public URL | `https://tezfarmo.qobus.tj` |
| Compose file | `docker-compose.prod.yml` |
| Compose network | `tezfarmo-prod` |

The **host nginx** (outside Docker, managed outside this repository — never modified by a deployment)
terminates TLS and proxies:

```
/api/  ->  127.0.0.1:8211   (tezfarmo-prod-backend, uvicorn on :8000)
/      ->  127.0.0.1:8212   (tezfarmo-prod-frontend, nginx serving the Vite bundle)
```

Both published ports are bound to `127.0.0.1`. `postgres`, `redis` and `storage` publish **no** host
port: they are reachable only over the `tezfarmo-prod` bridge network. CI enforces this on every
commit (`deployment-config` job in [ci.yml](../.github/workflows/ci.yml)).

The frontend calls the API at the relative path `/api/v1`
([`API_BASE`](../frontend/src/shared/api/client.ts)), so the bundle needs no build-time API URL: the
browser reaches the API on the same origin, and the host nginx routes it.

| Container | Image | Data |
| --- | --- | --- |
| `tezfarmo-prod-postgres` | `postgres:16-alpine` | volume `tezfarmo_prod_postgres` |
| `tezfarmo-prod-redis` | `redis:7-alpine` | volume `tezfarmo_prod_redis` |
| `tezfarmo-prod-storage` | `chrislusf/seaweedfs:latest` | volume `tezfarmo_prod_storage` |
| `tezfarmo-prod-backend` | built from `./backend` | stateless |
| `tezfarmo-prod-frontend` | built from `./frontend` | stateless |

> The Compose **project name** is derived from the directory name, and the volume names above are
> prefixed with it. The checkout must therefore stay at `/home/dev/Project-FastAPI`: running the same
> file from another directory would silently resolve to different, empty volumes. Confirm the running
> project with
> `docker inspect tezfarmo-prod-postgres --format '{{index .Config.Labels "com.docker.compose.project"}}'`.
>
> Because the `container_name` values are fixed, only **one** copy of this stack can run on a host:
> starting it from a second directory or with `-p` would collide on `tezfarmo-prod-backend` rather
> than create a second environment. Do not use this file for a staging stack on the same server.

## One-time server setup

Three files live only on the server. All three are gitignored, so `git fetch` + `git checkout` never
touch them and the working tree stays clean.

**1. `/home/dev/Project-FastAPI/.env`** — the Compose env file, read for `${POSTGRES_*}` in
`docker-compose.prod.yml`. These must match the credentials already inside the existing
`tezfarmo_prod_postgres` volume, otherwise PostgreSQL will reject connections:

```bash
cd /home/dev/Project-FastAPI
cat > .env <<'EOF'
POSTGRES_DB=<existing database name>
POSTGRES_USER=<existing database user>
POSTGRES_PASSWORD=<existing database password>
EOF
chmod 600 .env
```

**2. `/home/dev/Project-FastAPI/backend/.env`** — the application settings, passed to the backend
container through `env_file`. Use [`.env.example`](../.env.example) as the list of keys. Production
values that differ from the development example:

| Key | Production value |
| --- | --- |
| `APP_ENV` | `production` (also disables `/api/v1/docs`) |
| `APP_DEBUG` | `false` |
| `DATABASE_URL` | `postgresql+asyncpg://<user>:<password>@postgres:5432/<db>` — the **container** hostname, matching `.env` above |
| `REDIS_URL` | `redis://redis:6379/0` |
| `S3_ENDPOINT` | `storage:8333` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | must match `infra/seaweedfs/s3.prod.json` |
| `S3_SECURE` | `false` (plain HTTP inside the Docker network only) |
| `CORS_ORIGINS` / `FRONTEND_BASE_URL` | `https://tezfarmo.qobus.tj` |
| `APP_SECRET_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 32+ random bytes each, e.g. `openssl rand -hex 32` (SEC-003) |
| `EMAIL_PROVIDER` | `smtp` — `console` is rejected in production |
| `SMTP_HOST`, `FROM_EMAIL` | required; plus `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` for the provider |

```bash
chmod 600 backend/.env
```

`APP_ENV=production` is validated on startup by
[`Settings`](../backend/app/core/config.py) and the container **refuses to boot** unless all three
secrets are 32+ bytes and are not the development defaults, `APP_DEBUG=false`, and
`EMAIL_PROVIDER=smtp` with `SMTP_HOST` and `FROM_EMAIL` set. A deployment that fails its health check
immediately after a `backend/.env` change is almost always this validator — check
`docker compose -f docker-compose.prod.yml logs --tail=50 backend`.

**3. `/home/dev/Project-FastAPI/infra/seaweedfs/s3.prod.json`** — the S3 identity for the storage
container. See [infra/seaweedfs/README.md](../infra/seaweedfs/README.md):

```bash
cp infra/seaweedfs/s3.prod.json.example infra/seaweedfs/s3.prod.json
# replace REPLACE_ME with `openssl rand -hex 32`, and keep accessKey/secretKey in sync with backend/.env
chmod 600 infra/seaweedfs/s3.prod.json
```

If this file is missing when Compose starts `storage`, Docker creates an **empty directory** at that
path and SeaweedFS fails to start. The deploy script refuses to run in that state.

### GitHub repository configuration

Secrets (**Settings → Secrets and variables → Actions → Secrets**):

| Secret | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | private half of a deploy-only SSH keypair whose public half is in `/home/dev/.ssh/authorized_keys` |
| `DEPLOY_SSH_KNOWN_HOSTS` | output of `ssh-keyscan -H 37.27.245.216` — pins the host key, so `StrictHostKeyChecking=yes` can be used |

Generate the keypair off the server and add only the public half there:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./tezfarmo_deploy -N ""
# public half -> /home/dev/.ssh/authorized_keys on the server; private half -> DEPLOY_SSH_KEY; then delete both local files
ssh-keyscan -H 37.27.245.216        # -> DEPLOY_SSH_KNOWN_HOSTS
```

Variables (optional — the workflow falls back to the values above): `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_PATH`, `DEPLOY_SSH_PORT`.

> `ssh-keyscan` must be run against **exactly** the value the workflow connects to. The pinned entries
> are matched by host, so a `known_hosts` scanned from `37.27.245.216` does not verify a `DEPLOY_HOST`
> variable set to a DNS name (and vice versa) — host verification then fails with
> `Host key verification failed`, which is the correct refusal, not a bug. If you set `DEPLOY_HOST`,
> re-scan that name. Scanning both and storing both lines is also fine.

An **Environment** named `production` (**Settings → Environments**) is referenced by the workflow; add
required reviewers there if deployments should need an approval.

### Verify the setup before the first deployment

Three server-side prerequisites are **not** created by a deployment and are not visible in CI. The
deploy script fails cleanly without them, but checking first turns a failed deployment into a
two-minute fix. Run these as the `dev` user on the server:

```bash
# 1. the deploy account can reach the Docker daemon (membership in the docker group).
#    `docker compose version` does NOT contact the daemon, so it succeeds even when this is wrong —
#    `docker ps` is the check that actually proves it.
docker ps >/dev/null && echo "docker: ok"
#    if this prints a permission error:  sudo usermod -aG docker dev   (then log out and back in)

# 2. the checkout can fetch non-interactively. A deployment runs `git fetch` with no TTY, so a
#    private repository needs a stored credential or a deploy key here; a public one needs nothing.
cd /home/dev/Project-FastAPI && GIT_TERMINAL_PROMPT=0 git fetch --dry-run origin && echo "fetch: ok"

# 3. the three server-only files exist and the tree is clean (the script requires both).
test -s .env && test -s backend/.env && test -s infra/seaweedfs/s3.prod.json && echo "config: ok"
git status --porcelain   # must print nothing
```

And from your machine, that the key GitHub will use actually works:

```bash
ssh -i ./tezfarmo_deploy -o IdentitiesOnly=yes -o BatchMode=yes dev@37.27.245.216 'echo ssh: ok'
```

## How a deployment runs

`deploy.yml` starts when the **CI** workflow completes successfully for a push to `main`, and deploys
`workflow_run.head_sha` — the exact commit CI validated, not whatever `origin/main` points at by the
time SSH connects. `concurrency: deploy-production` with `cancel-in-progress: false` means only one
deployment runs at a time and a running one is never cancelled midway.

Before connecting, the workflow requires a **successful CI run for that exact SHA** (queried by
`head_sha`, then re-checked — a green run on a newer or older commit cannot authorise the deployment),
and it connects with `StrictHostKeyChecking=yes` against the pinned `DEPLOY_SSH_KNOWN_HOSTS`.

It then pipes `infra/deploy/remote-deploy.sh` to the server over SSH. The script:

1. validates `DEPLOY_SHA` (must be 40 hex characters) and `cd`s into `/home/dev/Project-FastAPI`;
2. verifies `origin` is this repository and that the working tree is clean;
3. verifies the three server-only files exist — `.env`, `backend/.env`,
   `infra/seaweedfs/s3.prod.json` (and that the last is a *file*, not a directory Docker created from
   a missing bind mount);
4. verifies the **settings the production validator requires** are present in `backend/.env`:
   `APP_ENV=production`, `APP_DEBUG=false`, `EMAIL_PROVIDER=smtp`, non-empty `SMTP_HOST`,
   `FROM_EMAIL`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `FRONTEND_BASE_URL`, `S3_*`, and the
   three secrets at 32+ characters. Only key names (and, for secrets, a length) are ever reported —
   **no value is printed, logged or exported**;
5. `git fetch --prune origin` (and fetches the SHA directly if it is not reachable from a branch) —
   never `git pull`;
6. refuses a commit that is not an ancestor of `origin/main`, so a pull-request head that happened to
   pass CI cannot reach production (`ALLOW_OFF_MAIN=1` overrides this deliberately, for a rewritten
   history);
7. `git checkout --force --detach <sha>`, asserts `HEAD` is that SHA, and re-validates the Compose
   file from that commit;
8. `docker compose -f docker-compose.prod.yml up -d --build --no-deps backend frontend`;
9. `docker compose -f docker-compose.prod.yml run --rm --no-deps backend alembic upgrade head`;
10. checks both containers report `running`;
11. health checks, each retried for up to 120 s — `http://127.0.0.1:8211/api/v1/meta`,
    `http://127.0.0.1:8211/api/health/ready` (503 unless PostgreSQL **and** Redis are reachable), and
    `https://tezfarmo.qobus.tj/api/v1/meta`. The deployment **fails** if any of them never succeeds.

Steps 1–7 run before anything changes: a failure there leaves the stack exactly as it was. From step 8
onward, any failure prints `docker compose ps`, each container's status/exit code/restart count, and
the last 80 log lines of `backend` and `frontend` — and then the previous known-good SHA with the exact
rollback command. Diagnostics never include environment variables, `.env` contents or credentials, and
the Compose file is only ever validated with `config --quiet` so that rendered `env_file` values are
never emitted.

Migrations are a separate, explicit step: the backend image does **not** run Alembic on start, so a
container restart can never migrate the database on its own. They are **forward-only** — the script
runs `alembic upgrade head` and never `alembic downgrade`, in a normal deployment or in a rollback.
A failed migration fails the deployment.

## Manual deployment

Identical to the automatic path, because it runs the same script. From the repository on your machine:

```bash
SHA=$(git rev-parse origin/main)
ssh dev@37.27.245.216 \
  "DEPLOY_SHA='$SHA' EXPECTED_REMOTE='https://github.com/muhammaddev04/Project-FastAPI.git' bash -s" \
  < infra/deploy/remote-deploy.sh
```

Or on the server itself:

```bash
cd /home/dev/Project-FastAPI
DEPLOY_SHA=<full 40-char sha> \
EXPECTED_REMOTE=https://github.com/muhammaddev04/Project-FastAPI.git \
bash infra/deploy/remote-deploy.sh
```

## Rollback

A rollback is a deployment of an earlier commit — the same procedure, the same script, and **no change
to any production secret or `.env`**. There is deliberately **no automatic rollback**: a failed health
check prints the previous SHA and the command below, and leaves the decision to a human.

```
previous known-good SHA
        ↓   (CI for that SHA must be green — the gate applies to a rollback too)
checkout exact SHA           git fetch + git checkout --force --detach <sha>
        ↓
build backend / frontend     up -d --build --no-deps backend frontend   (data services untouched)
        ↓
migration                    alembic upgrade head   — forward-only, never downgraded
        ↓
health checks                /api/v1/meta  +  /api/health/ready  +  https://tezfarmo.qobus.tj/api/v1/meta
        ↓
rollback SUCCESS
```

1. Pick the last known-good full SHA. A failed deployment prints it directly (`previous known-good
   commit: …`), as does the summary of the previous successful run; otherwise:

   ```bash
   ssh dev@37.27.245.216 'cd /home/dev/Project-FastAPI && git log --oneline -20 HEAD@{1} HEAD'
   ```

2. Run the deployment with that SHA — **Actions → Deploy (production) → Run workflow**, entering the
   full 40-character SHA. The workflow still requires a successful CI run for that commit.

   Equivalently, by hand:

   ```bash
   ssh dev@37.27.245.216 \
     "DEPLOY_SHA='<known-good-sha>' EXPECTED_REMOTE='https://github.com/muhammaddev04/Project-FastAPI.git' bash -s" \
     < infra/deploy/remote-deploy.sh
   ```

3. Confirm `https://tezfarmo.qobus.tj/api/v1/meta` responds — the script does this and fails if not.

**Database migrations do not roll back.** Rolling the code back runs `alembic upgrade head` against
the older code, which is a no-op; it does **not** downgrade the schema. If the release being rolled
back contained a destructive migration, plan the schema change separately (`alembic downgrade` against
a verified backup) before rolling the code back.

## Safety rules

The deploy script is written so these cannot happen by accident, and they must not be done by hand
either:

- never `docker compose down` (and never `down -v`) — it would stop the data services;
- never remove the `tezfarmo_prod_*` volumes, and never recreate `postgres`, `redis` or `storage` as
  part of a normal deployment (`--no-deps` is what keeps them untouched);
- never touch containers or volumes belonging to other projects on this host; no broad commands such
  as `docker stop $(docker ps -q)` or `docker system prune -a`;
- never modify the host nginx configuration or TLS certificates from a deployment;
- never modify `backend/.env`, `.env` or `infra/seaweedfs/s3.prod.json` from a deployment;
- keep every action inside `/home/dev/Project-FastAPI` and the `backend` / `frontend` services.

Reclaiming disk space from old images is safe and scoped: `docker image prune -f` (dangling images
only — not `-a`).

## Troubleshooting

```bash
cd /home/dev/Project-FastAPI
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 backend
docker compose -f docker-compose.prod.yml logs --tail=100 frontend
curl -fsS http://127.0.0.1:8211/api/health/ready    # per-dependency status: postgres, redis
curl -fsS http://127.0.0.1:8211/api/v1/meta
git log --oneline -1                                 # which commit is deployed
```

| Symptom | Likely cause |
| --- | --- |
| `working tree is not clean` | someone edited files on the server; inspect `git status` and revert or commit upstream |
| `backend/.env is missing or empty` | one-time setup was not done, or the file was moved |
| `s3.prod.json is a DIRECTORY` | Compose started `storage` while the file was missing; remove the directory and copy the template |
| `must set APP_ENV=production` / `EMAIL_PROVIDER=smtp` | `backend/.env` would fail the startup validator; fix it on the server (the preflight never prints values) |
| `… is N characters, production requires at least 32` | one of the three secrets in `backend/.env` is too short (SEC-003) |
| `is not an ancestor of origin/main` | the SHA is not on `main` (a PR head, or history was rewritten — `ALLOW_OFF_MAIN=1` to override deliberately) |
| `commit … is not available from origin` | the SHA does not exist on the remote — usually a typo in a manual `workflow_dispatch` rollback, or a commit that was never pushed |
| `no successful CI run found for …` | CI has not passed for that exact commit; the gate refuses to deploy an unvalidated SHA (check the Actions tab for that SHA) |
| `Host key verification failed` (in Actions) | `DEPLOY_SSH_KNOWN_HOSTS` was scanned from a different host/name than the workflow connects to — re-run `ssh-keyscan` against the exact `DEPLOY_HOST` |
| `permission denied … docker.sock` (in the deploy log) | the `dev` account is not in the `docker` group — see [Verify the setup](#verify-the-setup-before-the-first-deployment) |
| `/api/health/ready` reports `postgres: unavailable` | `DATABASE_URL` in `backend/.env` does not use host `postgres:5432`, or does not match `.env` |
| `/api/health/ready` reports `redis: unavailable` | `REDIS_URL` is not `redis://redis:6379/0` |
| local health check passes, public one fails | host nginx, DNS or TLS — outside this repository |
| `alembic upgrade head` fails | migration error; the new containers are already running against the old schema — fix forward or roll back |

## Local development

`docker-compose.prod.yml` is production-only. For local work use
[docker-compose.yml](../docker-compose.yml) (dev services, ports `5433` / `6380` / `9000`) and
[docker-compose.test.yml](../docker-compose.test.yml) (throwaway services for `pytest`); both use the
committed dev-only credentials in `infra/seaweedfs/s3.json`.
