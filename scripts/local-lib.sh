#!/usr/bin/env bash

# Shared primitives for the localhost production-build runtime. This file must
# never print environment values: .env.local contains credentials and tokens.

set -euo pipefail

HANAMARU_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HANAMARU_RUNTIME_DIR="$HANAMARU_REPO_DIR/.tmp/local-runtime"
HANAMARU_PID_DIR="$HANAMARU_RUNTIME_DIR/pids"
HANAMARU_LOG_DIR="$HANAMARU_RUNTIME_DIR/logs"
HANAMARU_PG_DATA="$HANAMARU_RUNTIME_DIR/postgres/data"
HANAMARU_PG_SOCKET="$HANAMARU_RUNTIME_DIR/postgres/socket"
HANAMARU_STORAGE_DIR="$HANAMARU_RUNTIME_DIR/storage"
HANAMARU_ENV_FILE="${HANAMARU_ENV_FILE:-$HANAMARU_REPO_DIR/.env.local}"

hanamaru_info() { printf '[local] %s\n' "$*"; }
hanamaru_fail() { printf '[local] ERROR: %s\n' "$*" >&2; exit 1; }

hanamaru_use_node22() {
  local current_major candidate candidate_major
  current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  if [[ "$current_major" == "22" ]]; then
    return
  fi

  for candidate in \
    "/opt/homebrew/opt/node@22/bin/node" \
    "/usr/local/opt/node@22/bin/node"; do
    if [[ -x "$candidate" ]]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done

  current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  if [[ "$current_major" != "22" ]]; then
    candidate="$(find "${NVM_DIR:-$HOME/.nvm}/versions/node" -type f -path '*/v22.*/bin/node' 2>/dev/null | sort | tail -1 || true)"
    if [[ -n "$candidate" ]]; then
      candidate_major="$($candidate -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
      if [[ "$candidate_major" == "22" ]]; then
        export PATH="$(dirname "$candidate"):$PATH"
      fi
    fi
  fi

  current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [[ "$current_major" == "22" ]] || hanamaru_fail "Node.js 22.x が必要です。現在のPATHまたはnvm/HomebrewへNode.js 22を用意してください。"
}

hanamaru_load_env() {
  [[ -f "$HANAMARU_ENV_FILE" ]] || hanamaru_fail ".env.local がありません。.env.exampleをコピーして秘密値を設定してください。"

  local permission invalid_lines=0 line key value first last
  permission="$(stat -f '%Lp' "$HANAMARU_ENV_FILE" 2>/dev/null || stat -c '%a' "$HANAMARU_ENV_FILE" 2>/dev/null || true)"
  [[ "$permission" =~ ^[0-9]+$ ]] || hanamaru_fail ".env.local のpermissionを確認できません。"
  if (( 10#$permission % 100 != 0 )); then
    hanamaru_fail ".env.local は所有者以外から読めないpermission（chmod 600）が必要です。"
  fi

  local assignment_pattern='^[A-Za-z_][A-Za-z0-9_]*='
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ $assignment_pattern ]]; then
      invalid_lines=$((invalid_lines + 1))
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if (( ${#value} >= 2 )); then
      first="${value:0:1}"
      last="${value: -1}"
      if [[ ( "$first" == '"' && "$last" == '"' ) || ( "$first" == "'" && "$last" == "'" ) ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    export "$key=$value"
  done < "$HANAMARU_ENV_FILE"
  (( invalid_lines == 0 )) || hanamaru_fail ".env.local は KEY=value とコメントだけを使用してください（不正行: ${invalid_lines}件）。"
}

hanamaru_require_command() {
  command -v "$1" >/dev/null 2>&1 || hanamaru_fail "$1 が見つかりません。"
}

hanamaru_require_env() {
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || hanamaru_fail "$name が.env.localに設定されていません。"
  done
}

hanamaru_pg_bin() {
  local prefix candidate version
  prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
  for candidate in \
    "${prefix:+$prefix/bin}" \
    "/usr/lib/postgresql/16/bin" \
    "$(dirname "$(command -v postgres 2>/dev/null || printf '/not-found/postgres')")"; do
    [[ -x "$candidate/postgres" ]] || continue
    version="$($candidate/postgres --version 2>/dev/null || true)"
    case "$version" in
      *"PostgreSQL) 16."*|*"PostgreSQL 16."*) ;;
      *) continue ;;
    esac
    printf '%s' "$candidate"
    return 0
  done
  hanamaru_fail "PostgreSQL 16 が見つかりません。"
}

hanamaru_port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

hanamaru_pid_alive() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1
}

hanamaru_wait_url() {
  local url="$1" attempts="${2:-120}" index
  for ((index=1; index<=attempts; index+=1)); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
