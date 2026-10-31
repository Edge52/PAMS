#!/bin/bash
# Double-click on a Mac to run Hospital PAMS with your own data (kept in the .pglite-data folder).
cd "$(dirname "$0")" || exit 1
exec bash scripts/mac-launch.sh local
