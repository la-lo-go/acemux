#!/bin/sh
set -e
# Fix permissions on the mounted data directory so bun user can write
mkdir -p /app/data
chown -R bun:bun /app/data
# Drop privileges and run the app
exec su-exec bun bun ./dist/server/entry.mjs
