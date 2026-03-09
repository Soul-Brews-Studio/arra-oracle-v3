#!/bin/bash
# Install Oracle Server as macOS LaunchAgent
# Runs at login with logging

set -e

PLIST_NAME="com.oracle.server.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/.oracle"

echo "🔮 Oracle Server LaunchAgent Installer"
echo "======================================="

# Create log directory
mkdir -p "$LOG_DIR"
echo "✓ Log directory: $LOG_DIR"

# Stop existing service if running
if launchctl list | grep -q "com.oracle.server"; then
    echo "→ Stopping existing service..."
    launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# Copy plist
cp "$PLIST_SRC" "$PLIST_DST"
echo "✓ Installed: $PLIST_DST"

# Load service
launchctl load "$PLIST_DST"
echo "✓ Service loaded"

# Check status
sleep 1
if launchctl list | grep -q "com.oracle.server"; then
    echo ""
    echo "🔮 Oracle Server is now running!"
    echo ""
    echo "   URL: http://localhost:47778"
    echo "   Logs: $LOG_DIR/oracle-server.log"
    echo "   Errors: $LOG_DIR/oracle-server.error.log"
    echo ""
    echo "Commands:"
    echo "   Stop:    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
    echo "   Start:   launchctl load ~/Library/LaunchAgents/$PLIST_NAME"
    echo "   Status:  launchctl list | grep oracle"
    echo "   Logs:    tail -f ~/.oracle/oracle-server.log"
else
    echo "⚠ Service may not have started. Check logs:"
    echo "   tail -f $LOG_DIR/oracle-server.error.log"
fi
