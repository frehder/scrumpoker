# Scrum Poker

A lightweight, real-time planning poker app for remote teams. No accounts, no database — just share a link and start estimating.

## Features

- Create a room instantly; share the URL with your team
- Each participant votes privately; votes stay hidden until revealed
- **Show Votes** button reveals everyone's cards at once
- **Reset** clears all votes for the next story
- Spectator mode for people who observe but don't vote
- Story point options: `0` `0.5` `1` `2` `3` `5` `8` `13` `?` `9999`
- Average score shown after reveal (numeric votes only)
- In-memory state — no database required; rooms are cleaned up when everyone leaves

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| HTTP server | Express 4 |
| Real-time | Socket.io 4 |
| Frontend | Vanilla HTML / CSS / JS (no framework) |
| Container | Docker (Alpine-based, non-root) |

## Local development

```bash
pnpm install
pnpm dev       # starts server with --watch on port 3000
```

Open `http://localhost:3000`, click **Create a Room** and share the URL with teammates.

## Deployment

The app ships as a Docker image built locally and streamed directly to your VPS — no container registry needed.

### Prerequisites

- Docker installed on your local machine
- Docker + Docker Compose (v2) installed on the VPS
- SSH key-based access to the VPS

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `SSH_DEPLOY_HOST` | VPS IP address or hostname |
| `SSH_DEPLOY_USER` | SSH user on the VPS |
| `SSH_DEPLOY_PORT` | SSH port (default: `22`) |
| `SSH_DEPLOY_APP_PATH` | Directory on the VPS where the app lives |
| `IMAGE_NAME` | Docker image name (default: `scrumpoker`) |
| `IMAGE_TAG` | Docker image tag (default: `latest`) |
| `APP_PORT` | Host port the app is exposed on (default: `3001`) |

### Deploy

```bash
./deploy.sh
```

The script will:

1. Build the Docker image locally
2. Copy `docker-compose.yml` to the VPS
3. Stream the image via `docker save | gzip | ssh … docker load`
4. Start the container with `docker compose up -d`
5. Prune old images on the VPS

The app will be available at `http://<VPS>:$APP_PORT` (default `3001`). Override the port by setting `APP_PORT` in `.env`.
