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

# Check if group already exists, create if not
if getent group "$PGID" >/dev/null 2>&1; then
    echo "Group with GID $PGID already exists"
else
    echo "Creating group with GID $PGID"
    addgroup -g "$PGID" appgroup || {
        echo "ERROR: Failed to create group with GID $PGID"
        exit 1
    }
fi

# Get the group name for the PGID
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$GROUP_NAME" ]; then
    echo "ERROR: Could not determine group name for GID $PGID"
    exit 1
fi

# Check if user already exists, create if not
if getent passwd "$PUID" >/dev/null 2>&1; then
    echo "User with UID $PUID already exists"
else
    echo "Creating user with UID $PUID"
    adduser -D -u "$PUID" -G "$GROUP_NAME" appuser || {
        echo "ERROR: Failed to create user with UID $PUID"
        exit 1
    }
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
# Use the username to avoid any potential issues with numeric UID syntax
echo "Starting application as user $USER_NAME ($PUID:$PGID)"
exec su -s /bin/sh "$USER_NAME" -c "exec bun ./dist/server/entry.mjs"
