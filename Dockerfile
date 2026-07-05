# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user with fixed UID/GID so host bind-mount permissions can match
RUN addgroup -S -g 1001 appgroup && adduser -S -u 1001 -G appgroup appuser
RUN mkdir -p /app/data && chown -R appuser:appgroup /app
USER appuser

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup server.js ./
COPY --chown=appuser:appgroup public ./public

EXPOSE 3000
CMD ["node", "server.js"]
