#!/bin/bash
# Install script to quickly register the Native Host for Google Chrome

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOST_NAME="com.joaosemedo.twitter_downloader"

# Target Directory for Google Chrome on macOS
TARGET_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"

mkdir -p "$TARGET_DIR"

# Copy the file
cp "$DIR/${HOST_NAME}.json" "$TARGET_DIR/${HOST_NAME}.json"

# Set script permissions
chmod +x "$DIR/native_host.py"

echo "Native App successfully installed to: $TARGET_DIR/${HOST_NAME}.json"
echo "Note: The Extension ID in com.joaosemedo.twitter_downloader.json MUST match the browser extension!"
