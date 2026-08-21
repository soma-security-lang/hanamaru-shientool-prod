#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"
hanamaru_use_node22
hanamaru_load_env
node "$HANAMARU_REPO_DIR/scripts/live-product-auth-e2e.mjs"
