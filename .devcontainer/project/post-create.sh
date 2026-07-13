#!/usr/bin/env bash
set -euo pipefail

# Repository-specific create-time setup belongs here.

# Chromium for playwright-cli. OS libs are baked by the playwright-deps
# feature; the binaries download into PLAYWRIGHT_BROWSERS_PATH (agents
# volume), so this is a no-op on rebuilds once cached.
bunx playwright-cli install-browser chromium
