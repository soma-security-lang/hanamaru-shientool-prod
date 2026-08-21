#!/usr/bin/env bash

release_guard_abort(){
  local status=$?
  trap - ERR INT TERM EXIT
  (( status != 0 )) || return 0
  echo "release failed; restoring Blue traffic" >&2
  rollback
  exit "$status"
}

release_guard_install(){
  trap release_guard_abort ERR INT TERM EXIT
}

release_guard_clear(){
  trap - ERR INT TERM EXIT
}
