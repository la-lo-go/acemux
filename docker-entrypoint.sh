#!/bin/sh
set -e

# Default to UID/GID 1000 if not set
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Starting AceMux with PUID=$PUID and PGID=$PGID"

# Validate that PUID and PGID are numeric
if ! echo "$PUID" | grep -qE '^[0-9]+$' || ! echo "$PGID" | grep -qE '^[0-9]+$'; then
    echo "ERROR: PUID and PGID must be numeric values"
    exit 1
fi

# Create group if it doesn't exist
if ! getent group "$PGID" >/dev/null 2>&1; then
    echo "Creating group with GID $PGID"
    if ! addgroup -g "$PGID" appgroup 2>/dev/null; then
        echo "WARNING: Could not create group with GID $PGID"
        # Continue anyway - the group might already exist or we'll fail later with better error
    fi
fi

# Get the group name for the PGID
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$GROUP_NAME" ]; then
    echo "ERROR: Could not determine group name for GID $PGID"
    exit 1
fi

# Create user if it doesn't exist
if ! getent passwd "$PUID" >/dev/null 2>&1; then
    echo "Creating user with UID $PUID"
    if ! adduser -D -u "$PUID" -G "$GROUP_NAME" appuser 2>/dev/null; then
        echo "WARNING: Could not create user with UID $PUID"
        # Continue anyway - the user might already exist or we'll fail later with better error
    fi
fi

# Get the user name for the PUID
USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
if [ -z "$USER_NAME" ]; then
    echo "ERROR: Could not determine user name for UID $PUID"
    exit 1
fi

# Ensure data directory exists and has correct permissions
echo "Setting up data directory permissions"
mkdir -p /app/data
chown -R "$PUID:$PGID" /app/data

# Execute the application as the specified user
# Use numeric IDs directly to avoid command injection
echo "Starting application as user $USER_NAME ($PUID:$PGID)"
exec su -s /bin/sh -c "exec bun ./dist/server/entry.mjs" "#$PUID"
