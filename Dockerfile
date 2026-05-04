# =============================================================================
# UI — static site (SvelteKit adapter-static). Export with BuildKit, e.g.:
#   docker buildx build --target ui-artifact --output type=local,dest=./ui-out .
# Build-args bake PUBLIC_* into the client bundle (set for production).
# =============================================================================
FROM oven/bun:1.2 AS ui-build

WORKDIR /app/ui

COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile

COPY ui/ .

ARG PUBLIC_ATSEARCH_URL
ARG PUBLIC_ATP_SERVICE=https://bsky.social
ARG PUBLIC_AT_FUNCTIONS_API=https://api.functions.at
ARG PUBLIC_DEFAULT_FUNCTIONS_HANDLE

ENV PUBLIC_ATSEARCH_URL=$PUBLIC_ATSEARCH_URL \
    PUBLIC_ATP_SERVICE=$PUBLIC_ATP_SERVICE \
    PUBLIC_AT_FUNCTIONS_API=$PUBLIC_AT_FUNCTIONS_API \
    PUBLIC_DEFAULT_FUNCTIONS_HANDLE=$PUBLIC_DEFAULT_FUNCTIONS_HANDLE

RUN bun run build

FROM scratch AS ui-artifact
COPY --from=ui-build /app/ui/build/ /

# =============================================================================
# API — default image target (WASM runner + Fastify)
# =============================================================================
FROM oven/bun:1.2 AS api

# Install Node.js 22 (required for componentRunner.mjs child process — jco uses
# Node.js internals not supported by Bun, so component-v1 execution spawns node)
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["bun", "src/server.ts"]
