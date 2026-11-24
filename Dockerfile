# The site as a Node server for the NAS (docs/self-host-plan.md).
#
#   docker build --build-arg SITE_SHA=<sha> -t personal-website:<sha> .
#
# Builds with no secrets: the RAWG key and the photo index are read when the
# container runs (astro:env).
# deploy/deploy.sh runs this build with the legacy builder so it can cap the
# build's memory and CPU share; nothing here needs BuildKit.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- deps: every dependency, dev included (astro check, beasties, typescript)
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: astro check + astro build for the Node target, then drop dev deps
FROM deps AS build
ENV DEPLOY_TARGET=node \
    NODE_OPTIONS=--max-old-space-size=1024
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- runtime: the built site, server.mjs and production node_modules
FROM ${NODE_IMAGE} AS runtime
ARG SITE_SHA=unknown
LABEL org.opencontainers.image.title="personal-website" \
      org.opencontainers.image.source="https://github.com/liambsulliva/personal-website-v3" \
      org.opencontainers.image.revision="${SITE_SHA}"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    ASTRO_TELEMETRY_DISABLED=1 \
    SITE_SHA=${SITE_SHA} \
    NODE_OPTIONS=--max-old-space-size=256
WORKDIR /app
# Owned by root and read-only to the server, which never writes to disk.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/src/lib/redirects.mjs ./src/lib/redirects.mjs
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4321/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.mjs"]
