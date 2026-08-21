#!/usr/bin/env bash

# Cloud Run traffic tags are part of a hostname. Do not truncate or normalize a
# requested tag because that severs the release evidence from its Git commit.
release_tag_from_commit(){
  local commit_sha="$1"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "GIT_COMMIT_SHA must be a lowercase 40-character Git commit SHA" >&2
    return 2
  }
  printf 'g-%s\n' "${commit_sha:0:12}"
}

validate_release_tag(){
  local tag="$1"
  shift
  [[ "$tag" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || {
    echo "release tag must match ^[a-z][a-z0-9-]{0,31}$" >&2
    return 2
  }
  [[ "$tag" != *- ]] || {
    echo "release tag must not end with a hyphen" >&2
    return 2
  }
  local service
  for service in "$@"; do
    [[ "$service" =~ ^[a-z][a-z0-9-]{0,62}$ && "$service" != *- ]] || {
      echo "invalid Cloud Run service name" >&2
      return 2
    }
    if (( ${#service} + ${#tag} > 46 )); then
      echo "release tag and service name exceed the audited combined limit" >&2
      return 2
    fi
  done
}
