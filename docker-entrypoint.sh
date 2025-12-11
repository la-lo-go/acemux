#!/bin/sh
set -e

# Default to UID/GID 1000 if not set
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Starting AceMux with PUID=$PUID and PGID=$PGID"

# Create group if it doesn't exist
if ! getent group "$PGID" >/dev/null 2>&1; then
    echo "Creating group with GID $PGID"
    addgroup -g "$PGID" appgroup 2>/dev/null || true
fi

# Create user if it doesn't exist
if ! getent passwd "$PUID" >/dev/null 2>&1; then
    echo "Creating user with UID $PUID"
    adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" appuser 2>/dev/null || true
fi

# Ensure data directory exists and has correct permissions
echo "Setting up data directory permissions"
mkdir -p /app/data
chown -R "$PUID:$PGID" /app/data

# Execute the application as the specified user
echo "Starting application as user $PUID:$PGID"
exec su-exec "$PUID:$PGID" bun ./dist/server/entry.mjs
