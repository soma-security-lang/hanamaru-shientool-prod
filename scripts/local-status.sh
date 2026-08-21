#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

overall=0
for component in api worker web; do
  pid_file="$HANAMARU_PID_DIR/$component.pid"
  pid=""
  [[ -f "$pid_file" ]] && pid="$(<"$pid_file")"
  if hanamaru_pid_alive "$pid"; then
    hanamaru_info "$component: running (pid $pid)"
  else
    hanamaru_info "$component: stopped"
    overall=1
  fi
done

pg_bin="$(hanamaru_pg_bin)"
if [[ -f "$HANAMARU_PG_DATA/PG_VERSION" ]] && "$pg_bin/pg_ctl" -D "$HANAMARU_PG_DATA" status >/dev/null 2>&1; then
  hanamaru_info "postgres: running"
else
  hanamaru_info "postgres: stopped"
  overall=1
fi

if [[ -f "$HANAMARU_RUNTIME_DIR/status.json" ]]; then
  jq '{startedAt,gitSha,node,pnpm,url,mode}' "$HANAMARU_RUNTIME_DIR/status.json"
fi
exit "$overall"
