#!/bin/bash
cd /home/runner/workspace

# Try to resurrect saved PM2 processes, otherwise start fresh
if pm2 list | grep -q "trekker-wabot"; then
    echo "PM2 process already running"
else
    pm2 resurrect || yarn start
fi

# Keep container running
tail -f /dev/null
