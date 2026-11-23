# The photo services (docs/photo-pipeline-plan.md): one image, three commands.
#
#   docker build -t personal-website-photos:<sha> services
#   node img/server.mjs     the resizer
#   node photos/main.mjs    the watcher
#   node repo/server.mjs    the GitHub token's keeper
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false \
    NODE_OPTIONS=--max-old-space-size=128 \
    MALLOC_ARENA_MAX=2
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY lib ./lib
COPY img ./img
COPY photos ./photos
COPY repo ./repo
USER node
CMD ["node", "img/server.mjs"]
