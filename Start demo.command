#!/bin/bash
# Double-click on a Mac to run the Hospital PAMS demo. Keep the window open while you use it.
cd "$(dirname "$0")" || exit 1
exec bash scripts/mac-launch.sh demo
