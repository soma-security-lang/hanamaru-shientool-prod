#!/usr/bin/env bash
set -Eeuo pipefail
# Explicitly approved Web-only security profile; the ordinary UI gate stays strict.
export WEB_RELEASE_PROFILE=next-security-20261023
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-ui-only.sh"
