FROM oven/bun:1.2

# Install Node.js 22 (required for componentRunner.mjs child process — jco uses
# Node.js internals not supported by Bun, so component-v1 execution spawns node)
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# HOST must be 0.0.0.0 inside the container so Docker can route traffic to it.
# The host machine binds this to 127.0.0.1 via -p 127.0.0.1:<host_port>:3000.
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["bun", "src/server.ts"]
