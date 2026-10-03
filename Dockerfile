# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.32.1
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && pnpm --filter @orca-web/server deploy --legacy --prod /production/server

# The official Orca artifact targets Ubuntu 24.04 (glibc 2.39).
FROM ubuntu:24.04 AS orca-runtime
ARG ORCA_VERSION=2.4.2
ARG ORCA_SHA256=d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates curl libgtk-3-0t64 libwebkit2gtk-4.1-0 \
      libgl1 libglu1-mesa libopengl0 libegl1 libsm6 libice6 \
      libgstreamer-plugins-base1.0-0 libmspack0t64 \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/install-orca.sh /tmp/install-orca.sh
RUN sh /tmp/install-orca.sh /opt/orca "$ORCA_VERSION" "$ORCA_SHA256" \
    && rm /tmp/install-orca.sh \
    && /opt/orca/AppRun --help >/dev/null \
    && mkdir -p /data /app \
    && chown 1000:1000 /data /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production \
    PORT=8084 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    ORCA_BIN=/opt/orca/AppRun \
    ORCA_RESOURCES=/opt/orca/resources \
    ORCA_VERSION=${ORCA_VERSION} \
    WEB_DIST=/app/apps/web/dist \
    XDG_CACHE_HOME=/data/.cache \
    XDG_CONFIG_HOME=/data/.config
WORKDIR /app
EXPOSE 8084

# Run the real API -> Orca -> G-code integration test in the deployed runtime.
# docker build --target integration -t orca-web-integration .
# docker run --rm --cap-drop ALL --security-opt no-new-privileges orca-web-integration
FROM orca-runtime AS integration
COPY --from=build /usr/local/ /usr/local/
COPY --from=build --chown=1000:1000 /app /app
USER 1000:1000
CMD ["pnpm", "test:integration"]

FROM orca-runtime AS production
COPY --from=build --chown=1000:1000 /production/server /app/apps/server
COPY --from=build --chown=1000:1000 /app/apps/web/dist /app/apps/web/dist
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8084/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
