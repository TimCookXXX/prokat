#!/bin/sh
set -e
echo "Running migrations..."
node migrate.cjs
echo "Syncing comparison catalog..."
node sync-catalog.cjs
echo "Starting Next.js..."
exec node server.js
