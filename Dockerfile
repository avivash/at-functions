# =============================================================================
# UI — static site (SvelteKit adapter-static). Export with BuildKit, e.g.:
#   docker buildx build --target ui-artifact --output type=local,dest=./ui-out .
# Build-args bake PUBLIC_* into the client bundle (set for production).
# =============================================================================
FROM node:22-slim AS ui-build

WORKDIR /app/ui

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY ui/ .

ARG PUBLIC_ATSEARCH_URL
ARG PUBLIC_ATP_SERVICE=https://bsky.social
ARG PUBLIC_AT_FUNCTIONS_API=https://api.functions.at
ARG PUBLIC_DEFAULT_FUNCTIONS_HANDLE

ENV PUBLIC_ATSEARCH_URL=$PUBLIC_ATSEARCH_URL \
    PUBLIC_ATP_SERVICE=$PUBLIC_ATP_SERVICE \
    PUBLIC_AT_FUNCTIONS_API=$PUBLIC_AT_FUNCTIONS_API \
    PUBLIC_DEFAULT_FUNCTIONS_HANDLE=$PUBLIC_DEFAULT_FUNCTIONS_HANDLE

RUN pnpm run build

FROM scratch AS ui-artifact
COPY --from=ui-build /app/ui/build/ /

# =============================================================================
# API — default image target (WASM runner + Fastify)
# =============================================================================
FROM node:22-slim AS api

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

RUN pnpm run build

CMD ["node", "dist/server.js"]
