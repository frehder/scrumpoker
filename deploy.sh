#!/usr/bin/env bash
# deploy.sh — build image locally, stream it to VPS, start via Docker Compose
set -euo pipefail

# ── Load .env if present ──────────────────────────────────────────────────────
if [[ -f "$(dirname "$0")/.env" ]]; then
  # shellcheck source=.env
  set -a; source "$(dirname "$0")/.env"; set +a
fi

# ── Config ────────────────────────────────────────────────────────────────────
SSH_DEPLOY_HOST="${SSH_DEPLOY_HOST:-YOUR_VPS_HOST}"
SSH_DEPLOY_USER="${SSH_DEPLOY_USER:-max}"
SSH_DEPLOY_PORT="${SSH_DEPLOY_PORT:-22}"
SSH_DEPLOY_APP_PATH="${SSH_DEPLOY_APP_PATH:-/opt/docker/scrumpoker}"
IMAGE_NAME="${IMAGE_NAME:-scrumpoker}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_PORT="${APP_PORT:-3001}"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo "[deploy] $*"; }
error() { echo "[deploy] ERROR: $*" >&2; exit 1; }

[[ "$SSH_DEPLOY_HOST" == "YOUR_VPS_HOST" ]] && \
  error "Set SSH_DEPLOY_HOST before deploying. Example: SSH_DEPLOY_HOST=1.2.3.4 ./deploy.sh"

SSH_OPTS=(-p "$SSH_DEPLOY_PORT")
SSH_TARGET="${SSH_DEPLOY_USER}@${SSH_DEPLOY_HOST}"

# ── 1. Build image locally ────────────────────────────────────────────────────
info "Building ${IMAGE_NAME}:${IMAGE_TAG} for linux/amd64 ..."
docker build --platform linux/amd64 -t "${IMAGE_NAME}:${IMAGE_TAG}" .

# ── 2. Copy docker-compose.yml to VPS ────────────────────────────────────────
info "Copying docker-compose.yml to VPS ..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p '${SSH_DEPLOY_APP_PATH}'"
scp -P "$SSH_DEPLOY_PORT" docker-compose.yml "${SSH_TARGET}:${SSH_DEPLOY_APP_PATH}/docker-compose.yml"

# ── 3. Stream image → VPS and start ──────────────────────────────────────────
info "Transferring image to VPS and starting container ..."
docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip | \
  ssh -p "$SSH_DEPLOY_PORT" "${SSH_DEPLOY_USER}@${SSH_DEPLOY_HOST}" \
    "docker load && cd '${SSH_DEPLOY_APP_PATH}' && \
     IMAGE_NAME='${IMAGE_NAME}' IMAGE_TAG='${IMAGE_TAG}' APP_PORT='${APP_PORT}' docker compose up -d"

# ── 4. Prune old images on VPS ────────────────────────────────────────────────
info "Pruning old images on VPS ..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "docker image prune -f"

info "Done! App is running at http://${SSH_DEPLOY_HOST}:${APP_PORT}"
