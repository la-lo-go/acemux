# Build stage - install deps and build
FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app

# Install all dependencies (needed for build)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Final stage - minimal runtime image
FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app

# tzdata so TZ works consistently, and su-exec for privilege dropping
RUN apk add --no-cache tzdata su-exec

# Only copy the built standalone server (no node_modules needed!)
COPY --from=builder /app/dist ./dist

# Entrypoint fixes the data-dir permissions then drops to the bun user, which
# works with named volumes and host bind mounts (Linux/NAS included).
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh && mkdir -p /app/data && chown -R bun:bun /app/data

ENV HOST=0.0.0.0
ENV PORT=4321
ENV DB_PATH=/app/data/db.sqlite
EXPOSE 4321/tcp

ENTRYPOINT ["/entrypoint.sh"]
