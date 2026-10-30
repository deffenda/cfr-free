# syntax=docker/dockerfile:1

# --- build stage: compile TypeScript, keep only production deps -------------
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
# --ignore-scripts: the package's `prepare` script runs the TypeScript build,
# and this stage installs dependencies BEFORE copying src/ — so `prepare` would
# run against an empty source tree and fail. The build is run explicitly below.
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime stage: minimal image, non-root, index in /data -----------------
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
LABEL org.opencontainers.image.title="cfr-free" \
      org.opencontainers.image.description="Self-hosted Title 38 CFR data service (MCP server + HTTP API over SQLite FTS5)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/deffenda/cfr-free"

RUN addgroup -S cfr && adduser -S -G cfr cfr
WORKDIR /app
ENV NODE_ENV=production \
    CFR_INDEX_PATH=/data/index.sqlite \
    CFR_HOST=0.0.0.0 \
    CFR_ALLOW_REMOTE=1
COPY --from=build --chown=cfr:cfr /app/dist ./dist
COPY --from=build --chown=cfr:cfr /app/node_modules ./node_modules
COPY --from=build --chown=cfr:cfr /app/package.json ./package.json
RUN mkdir -p /data && chown cfr:cfr /data
USER cfr

# Liveness probe; mirrors the healthcheck in docker-compose.yml exactly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

VOLUME /data
EXPOSE 8787

# The container binds 0.0.0.0 with the remote opt-in set, and that is a
# CONTAINER-NETWORKING requirement, not an exposure decision: a process bound
# to the container's own 127.0.0.1 cannot be reached through a published
# port, so the EXPOSURE GATE is the host-side published port.
#
# The documented default for that port is loopback — `-p 127.0.0.1:8787:8787`
# in the README and in docker-compose.yml — and publishing on every interface
# (`-p 8787:8787`) is the opt-in. The API has NO authentication, so an
# exposed port needs a reverse proxy with auth in front of it. Outside Docker
# the CLI still defaults to 127.0.0.1 with the opt-in required.
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
