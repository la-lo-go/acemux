# Build stage - install deps and build
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Install all dependencies (needed for build)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Final stage - minimal runtime image
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Only copy the built standalone server (no node_modules needed!)
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321/tcp

ENTRYPOINT [ "docker-entrypoint.sh" ]