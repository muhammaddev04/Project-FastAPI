#!/usr/bin/env bash
#
# TezFarmo production deployment, executed ON the production server.
#
# The GitHub Actions workflow (.github/workflows/deploy.yml) pipes this file to the server over SSH:
#   ssh dev@host "DEPLOY_SHA=<sha> EXPECTED_REMOTE=<repo> bash -s" < infra/deploy/remote-deploy.sh
# It can also be run by hand on the server (see docs/deployment.md), which is how a rollback works:
# a rollback is this same script with an earlier DEPLOY_SHA, nothing else.
#
# Scope and safety — this script, by construction:
#   * touches only $PROJECT_DIR and only the backend / frontend / Celery services of this project;
#   * never runs `docker compose down` / `down -v` / `system prune` / `docker stop $(docker ps -q)`,
#     never removes a volume, never recreates postgres / redis / storage;
#   * never runs `git pull` (fetch + checkout of one exact SHA only);
#   * never writes to backend/.env, to the Compose .env, to s3.prod.json or to the host nginx config;
#   * refuses to start unless the checkout is clean and every required config file is already in place;
#   * prints no environment variable, no .env content and no credential, in success or in failure.
#
# Migrations are forward-only here: `alembic upgrade head` runs on every deployment and the script
# never calls `alembic downgrade`. Rolling the code back does NOT roll the schema back.
#
# Required environment:
#   DEPLOY_SHA        full 40-character commit SHA to deploy (the exact commit CI validated)
#   EXPECTED_REMOTE   the repository `origin` must point at, e.g. https://github.com/<owner>/<repo>.git
# Optional:
#   PROJECT_DIR       default /home/dev/Project-FastAPI
#   LOCAL_HEALTH_URL  default http://127.0.0.1:8211/api/v1/meta
#   READY_HEALTH_URL  default http://127.0.0.1:8211/api/health/ready
#   PUBLIC_HEALTH_URL default https://tezfarmo.qobus.tj/api/v1/meta
#   HEALTH_TIMEOUT    seconds to wait for each health check, default 120
#   ALLOW_OFF_MAIN    set to 1 to deploy a commit that is not an ancestor of origin/main

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/dev/Project-FastAPI}"
COMPOSE_FILE="docker-compose.prod.yml"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:8211/api/v1/meta}"
READY_HEALTH_URL="${READY_HEALTH_URL:-http://127.0.0.1:8211/api/health/ready}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://tezfarmo.qobus.tj/api/v1/meta}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

# Only these services are ever built, started, inspected or logged. The web pair is started before
# migrations; the Celery pair is started after them, so Beat cannot dispatch a task into the old
# schema during the upgrade. SERVICES is the union, used for state checks, `ps` and diagnostics.
WEB_SERVICES=(backend frontend)
WORKER_SERVICES=(celery-worker celery-beat)
SERVICES=("${WEB_SERVICES[@]}" "${WORKER_SERVICES[@]}")
CONTAINERS=(tezfarmo-prod-backend tezfarmo-prod-frontend
            tezfarmo-prod-celery-worker tezfarmo-prod-celery-beat)

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# Set to 1 once containers may have changed, so the exit trap knows whether diagnostics are useful.
deploy_started=0
previous_sha="(unknown)"

# ---------------------------------------------------------------------------- failure handling

# Diagnostics are deliberately limited to container state and application logs. No `docker compose
# config` (it would render env_file values), no `docker inspect` of Env, no .env, no secrets.
diagnostics() {
  log "diagnostics (no environment variables, .env contents or credentials are printed)"
  docker compose -f "$COMPOSE_FILE" ps "${SERVICES[@]}" || true
  local container status
  for container in "${CONTAINERS[@]}"; do
    status="$(docker inspect -f '{{.State.Status}} (exit {{.State.ExitCode}}, restarts {{.RestartCount}})' \
              "$container" 2>/dev/null | tail -n 1)"
    printf '    %s: %s\n' "$container" "${status:-not present}"
  done
  log "last 80 log lines per service"
  docker compose -f "$COMPOSE_FILE" logs --no-color --tail=80 "${SERVICES[@]}" || true
}

# No automatic rollback: redeploying an older commit is a decision, not an automatic reaction to a
# failed health check. The previous SHA and the exact command to use are printed instead.
rollback_hint() {
  log "NO automatic rollback was performed"
  printf '    previous known-good commit: %s\n' "$previous_sha"
  printf '    to roll back, re-run this deployment with that SHA:\n'
  printf '      # from a clone of the repository\n'
  printf '      ssh %s@<server> "DEPLOY_SHA=%s EXPECTED_REMOTE=%s bash -s" \\\n' \
    "${USER:-dev}" "$previous_sha" "$EXPECTED_REMOTE"
  printf '        < infra/deploy/remote-deploy.sh\n'
  printf '      # or: GitHub Actions -> "Deploy (production)" -> Run workflow -> sha=%s\n' "$previous_sha"
  printf '    Migrations are NOT downgraded by a rollback (see docs/deployment.md).\n'
}

on_exit() {
  local code=$?
  trap - EXIT
  if (( code != 0 )) && (( deploy_started )); then
    diagnostics
    rollback_hint
  fi
  exit "$code"
}
trap on_exit EXIT

# ---------------------------------------------------------------------------- 0. inputs

: "${DEPLOY_SHA:?DEPLOY_SHA is required (full 40-character commit SHA)}"
: "${EXPECTED_REMOTE:?EXPECTED_REMOTE is required (expected origin URL)}"

# A validated SHA is what makes the rest of the script injection-proof: it is interpolated into git
# commands, so anything but 40 hex characters is rejected here.
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "DEPLOY_SHA must be a full 40-character lowercase SHA, got: $DEPLOY_SHA"

log "Deploying $DEPLOY_SHA to $PROJECT_DIR"

# ---------------------------------------------------------------------------- 1. preflight

[[ -d "$PROJECT_DIR" ]] || fail "project directory $PROJECT_DIR does not exist"
cd "$PROJECT_DIR"

[[ -d .git ]] || fail "$PROJECT_DIR is not a git checkout"
[[ -f "$COMPOSE_FILE" ]] || fail "$COMPOSE_FILE is missing in $PROJECT_DIR"

command -v docker >/dev/null || fail "docker is not on PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose (v2) is not available"
command -v curl >/dev/null || fail "curl is not on PATH"
command -v git >/dev/null || fail "git is not on PATH"

# The Compose project name is derived from the directory name; a different directory would resolve to
# different, empty volumes, so the data path is only correct from here.
log "Compose project: $(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')"

# Verify we are on the expected repository. Compares normalised forms so that https/ssh and a
# trailing .git do not cause a false mismatch, without accepting a different repository.
actual_remote="$(git remote get-url origin 2>/dev/null || true)"
[[ -n "$actual_remote" ]] || fail "no 'origin' remote configured in $PROJECT_DIR"
normalise_remote() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's#^git@github\.com:#github.com/#' \
          -e 's#^ssh://git@github\.com/#github.com/#' \
          -e 's#^https\?://[^/]*@#https://#' \
          -e 's#^https\?://##' \
          -e 's#\.git$##' \
          -e 's#/$##'
}
if [[ "$(normalise_remote "$actual_remote")" != "$(normalise_remote "$EXPECTED_REMOTE")" ]]; then
  fail "origin is '$actual_remote' but this deployment expects '$EXPECTED_REMOTE' — refusing to deploy"
fi
log "origin verified: $actual_remote"

# A dirty tree means someone edited the server by hand; `git checkout --force` would discard it, so stop.
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "working tree is not clean — resolve this on the server before deploying (nothing was changed)"
fi
log "working tree is clean"

# ------------------------------------------------- 1a. server-only configuration files are in place

# These three live only on the server (gitignored) and are never written by a deployment.
[[ -s backend/.env ]] || fail "backend/.env is missing or empty (one-time setup, see docs/deployment.md)"
[[ -s .env ]] || fail ".env with POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD is missing (see docs/deployment.md)"
if [[ -d infra/seaweedfs/s3.prod.json ]]; then
  fail "infra/seaweedfs/s3.prod.json is a DIRECTORY (Docker created it from a missing bind mount) — remove it and copy the template, see infra/seaweedfs/README.md"
fi
[[ -s infra/seaweedfs/s3.prod.json ]] || fail "infra/seaweedfs/s3.prod.json is missing (see infra/seaweedfs/README.md)"
log "server-side configuration files are present"

# ------------------------------------------------- 1b. required settings are present (names only)

# app/core/config.py refuses to start under APP_ENV=production unless these are set correctly, which
# would show up only as a container that will not boot. Catch it here instead.
#
# IMPORTANT: these helpers report only the key name (and, for secrets, a length) — a value is never
# echoed, logged or placed in the environment.

# Longest match wins for duplicated keys, which is also what a dotenv parser does (last one wins).
env_lookup() {
  local key="$1" file="$2"
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | tr -d '\r' | tail -n 1
}

require_env_set() {
  local key="$1" file="${2:-backend/.env}"
  [[ -n "$(env_lookup "$key" "$file")" ]] \
    || fail "$file has no non-empty $key (required in production, see docs/deployment.md)"
}

require_env_equals() {
  local key="$1" expected="$2" file="${3:-backend/.env}" actual
  actual="$(env_lookup "$key" "$file")"
  [[ "$actual" == "$expected" ]] \
    || fail "$file must set $key=$expected for a production deployment (app/core/config.py rejects anything else)"
}

require_env_min_length() {
  local key="$1" min="$2" file="${3:-backend/.env}" length
  length="$(env_lookup "$key" "$file" | tr -d "\"'" | wc -c)"
  length=$(( length > 0 ? length - 1 : 0 ))   # drop the trailing newline wc counts
  (( length >= min )) \
    || fail "$file: $key is $length characters, production requires at least $min (SEC-003). The value itself is not shown."
}

# APP_ENV / APP_DEBUG / EMAIL_PROVIDER are not secrets, so the expected value is named in the error.
require_env_equals APP_ENV production
require_env_equals APP_DEBUG false
require_env_equals EMAIL_PROVIDER smtp
for key in SMTP_HOST FROM_EMAIL DATABASE_URL REDIS_URL CORS_ORIGINS FRONTEND_BASE_URL \
           S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET_PRIVATE; do
  require_env_set "$key"
done
for key in APP_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET \
           DELIVERY_CODE_HMAC_SECRET DELIVERY_CODE_ENCRYPTION_KEY; do
  require_env_set "$key"
  require_env_min_length "$key" 32
done
for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
  require_env_set "$key" .env
done
log "required production settings are present (values were not read out or printed)"

# ---------------------------------------------------------------------------- 2. fetch the exact commit

# `git fetch` + checkout of one SHA, never `git pull`: the deployed tree is exactly the commit CI
# validated, not whatever main happens to point at now.
log "git fetch origin"
git fetch --prune origin
# A rollback target may no longer be reachable from a branch tip; ask for it directly if needed.
# The direct fetch is allowed to fail (a mistyped SHA is simply "not our ref" on the server): swallowing
# it here is what makes the explicit message below reachable instead of a raw `git upload-pack` fatal.
if ! git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null; then
  git fetch origin "$DEPLOY_SHA" 2>/dev/null || true
fi
git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null || fail "commit $DEPLOY_SHA is not available from origin"

# Refuse a commit that is not on main (e.g. a pull-request head that happened to pass CI). A rollback
# target is still an ancestor of main; ALLOW_OFF_MAIN=1 exists for a rewritten history.
if [[ "${ALLOW_OFF_MAIN:-0}" != "1" ]]; then
  git merge-base --is-ancestor "$DEPLOY_SHA" origin/main 2>/dev/null \
    || fail "$DEPLOY_SHA is not an ancestor of origin/main — refusing to deploy a commit that is not on main (set ALLOW_OFF_MAIN=1 to override deliberately)"
  log "commit is on origin/main"
fi

previous_sha="$(git rev-parse HEAD)"
log "current HEAD: $previous_sha"

# ---------------------------------------------------------------------------- 3. check out the exact commit

log "checking out $DEPLOY_SHA (detached)"
git checkout --force --detach "$DEPLOY_SHA"
[[ "$(git rev-parse HEAD)" == "$DEPLOY_SHA" ]] || fail "HEAD is not $DEPLOY_SHA after checkout"

# Re-validate after checkout: the deployed commit may change the Compose file itself. --quiet so that
# no rendered configuration (which would include env_file values) is ever printed.
docker compose -f "$COMPOSE_FILE" config --quiet \
  || fail "$COMPOSE_FILE from $DEPLOY_SHA is not a valid Compose configuration"

# ---------------------------------------------------------------------------- 4. build and start backend + frontend

# --no-deps keeps postgres / redis / storage exactly as they are: not recreated, not restarted.
# From here on a failure leaves the stack changed, so diagnostics and the rollback hint are printed.
deploy_started=1
log "building and starting ${WEB_SERVICES[*]}"
docker compose -f "$COMPOSE_FILE" up -d --build --no-deps "${WEB_SERVICES[@]}"

# ---------------------------------------------------------------------------- 5. migrations

# Deliberately a separate, explicit step (the image does not migrate on start), run as a one-off
# container that is removed afterwards. --no-deps leaves the data services untouched. Forward-only:
# a failure here fails the deployment, and nothing is ever downgraded automatically.
log "applying migrations: alembic upgrade head"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps backend alembic upgrade head \
  || fail "alembic upgrade head failed — the new containers are running against the old schema. Fix forward or roll back; the schema is NOT downgraded automatically."

# ---------------------------------------------------------------------------- 5b. scheduled work

# Started only now, on the migrated schema. Without these two containers the Celery Beat schedule
# (finance debt reminders and reconciliation, delivered-order completion, courier sync purge) never
# runs, so they are part of a deployment and are checked for "running" below like the web pair.
log "building and starting ${WORKER_SERVICES[*]}"
docker compose -f "$COMPOSE_FILE" up -d --build --no-deps "${WORKER_SERVICES[@]}"

# ---------------------------------------------------------------------------- 6. containers are running

log "checking container state"
for container in "${CONTAINERS[@]}"; do
  state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
  [[ "$state" == "running" ]] || fail "$container is '${state:-missing}', expected 'running'"
  restarts="$(docker inspect -f '{{.RestartCount}}' "$container" 2>/dev/null || echo 0)"
  printf '    %s: running (restart count %s)\n' "$container" "$restarts"
done

# ---------------------------------------------------------------------------- 7. health checks

# Every check must pass or the deployment fails. uvicorn needs a few seconds after the container
# reports "running", so each URL is retried until HEALTH_TIMEOUT.
#   * /api/v1/meta on 127.0.0.1:8211  — the backend container itself
#   * /api/health/ready               — PostgreSQL and Redis reachable (503 when not, so -f catches it)
#   * /api/v1/meta over HTTPS         — the host nginx, TLS and DNS path the public actually uses
wait_for_health() {
  local url="$1" deadline=$(( SECONDS + HEALTH_TIMEOUT ))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
      printf '    OK   %s\n' "$url"
      return 0
    fi
    sleep 3
  done
  printf '    FAIL %s (no success within %ss)\n' "$url" "$HEALTH_TIMEOUT" >&2
  return 1
}

log "health checks"
health_failed=0
wait_for_health "$LOCAL_HEALTH_URL"  || health_failed=1
wait_for_health "$READY_HEALTH_URL"  || health_failed=1
wait_for_health "$PUBLIC_HEALTH_URL" || health_failed=1

if (( health_failed )); then
  # The readiness body names the failing dependency and contains no credentials.
  printf '\n    readiness detail: '
  curl -sS --max-time 10 "$READY_HEALTH_URL" || true
  printf '\n'
  fail "deployment of $DEPLOY_SHA is unhealthy"
fi

# ---------------------------------------------------------------------------- 8. summary

log "deployment successful"
printf '    previous commit: %s\n' "$previous_sha"
printf '    deployed commit: %s\n' "$DEPLOY_SHA"
printf '    public URL:      %s\n' "$PUBLIC_HEALTH_URL"
docker compose -f "$COMPOSE_FILE" ps "${SERVICES[@]}" || true
