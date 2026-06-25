# The runtime base image, supplied per architecture by the Home Assistant builder
# from build.yaml. Declared globally so the runtime FROM below can consume it.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21

# Build the SPA and bundle the server. The outputs (static assets, the bundled
# server, and the production node_modules) are pure JavaScript and therefore
# architecture independent, so this stage runs on the native builder platform
# and its results are copied into every target architecture below.
FROM --platform=${BUILDPLATFORM:-linux/amd64} node:22-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts esbuild.server.mjs index.html ./
COPY src ./src
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN npm run build:web && npm run build:server

# Reduce node_modules to runtime dependencies only. --omit=optional drops the
# optional native addons of ws so the tree stays pure JavaScript and portable.
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# ---- runtime -----------------------------------------------------------------
FROM ${BUILD_FROM}

# Node runtime for the bundled server. The base image already ships s6-overlay
# v3 and bashio.
RUN apk add --no-cache nodejs

WORKDIR /app
ENV STATIC_ROOT=/app/public \
    INGRESS_PORT=8099 \
    NODE_ENV=production

COPY --from=build /build/dist-server ./dist-server
COPY --from=build /build/dist ./public
COPY --from=build /build/node_modules ./node_modules

# s6 service that launches the server (see rootfs/).
COPY rootfs /

# Build metadata supplied by the Home Assistant builder.
ARG BUILD_ARCH
ARG BUILD_DATE
ARG BUILD_DESCRIPTION
ARG BUILD_NAME
ARG BUILD_REF
ARG BUILD_REPOSITORY
ARG BUILD_VERSION
LABEL \
  io.hass.name="${BUILD_NAME}" \
  io.hass.description="${BUILD_DESCRIPTION}" \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="addon" \
  io.hass.version="${BUILD_VERSION}" \
  org.opencontainers.image.title="${BUILD_NAME}" \
  org.opencontainers.image.description="${BUILD_DESCRIPTION}" \
  org.opencontainers.image.source="https://github.com/sense360store/sense360zones" \
  org.opencontainers.image.revision="${BUILD_REF}" \
  org.opencontainers.image.version="${BUILD_VERSION}" \
  org.opencontainers.image.created="${BUILD_DATE}"
