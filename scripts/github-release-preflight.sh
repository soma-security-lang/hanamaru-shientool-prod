#!/usr/bin/env bash
set -Eeuo pipefail

repo="${GH_REPOSITORY:?GH_REPOSITORY is required}"
project_id="${PROJECT_ID:?PROJECT_ID is required}"
environment="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
provider="${GCP_WIF_PROVIDER:?GCP_WIF_PROVIDER is required}"
deploy_service_account="${GCP_DEPLOY_SERVICE_ACCOUNT:?GCP_DEPLOY_SERVICE_ACCOUNT is required}"

[[ "$repo" == "soma-security-lang/hanamaru-shientool-prod" ]] || {
  echo "release repository is not approved" >&2
  exit 2
}
[[ "$environment" == "pilot" || "$environment" == "prod" ]] || {
  echo "deployment environment is not approved" >&2
  exit 2
}

repo_json="$(gh api "repos/$repo")"
[[ "$(jq -r '.visibility' <<<"$repo_json")" == "private" ]] || {
  echo "repository must be PRIVATE before release" >&2
  exit 2
}
[[ "$(jq -r '.default_branch' <<<"$repo_json")" == "main" ]] || {
  echo "default branch must be main" >&2
  exit 2
}

branch_json="$(gh api "repos/$repo/branches/main")"
[[ "$(jq -r '.protected' <<<"$branch_json")" == "true" ]] || {
  echo "main branch protection is required" >&2
  exit 2
}
protection_json="$(gh api "repos/$repo/branches/main/protection")"
[[ "$(jq -r '.required_pull_request_reviews != null' <<<"$protection_json")" == "true" ]] || {
  echo "pull-request review protection is required" >&2
  exit 2
}
[[ "$(jq -r '(.required_status_checks.contexts // []) | index("CI / verify") != null' <<<"$protection_json")" == "true" ]] || {
  echo "required check CI / verify is missing" >&2
  exit 2
}

apply_environment="${environment}-apply"
environment_json="$(gh api "repos/$repo/environments/$apply_environment")"
[[ "$(jq -r '[.protection_rules[]? | select(.type == "required_reviewers")] | length > 0' <<<"$environment_json")" == "true" ]] || {
  echo "$apply_environment must require a human reviewer" >&2
  exit 2
}
[[ "$(jq -r '.deployment_branch_policy.protected_branches == true' <<<"$environment_json")" == "true" ]] || {
  echo "$apply_environment must allow protected branches only" >&2
  exit 2
}

expected_provider_prefix="projects/$(gcloud projects describe "$project_id" --format='value(projectNumber)')/locations/global/workloadIdentityPools/"
[[ "$provider" == "$expected_provider_prefix"*"/providers/"* ]] || {
  echo "workload identity provider is outside the approved project" >&2
  exit 2
}
provider_condition="$(gcloud iam workload-identity-pools providers describe "${provider##*/}" \
  --project="$project_id" \
  --location=global \
  --workload-identity-pool="$(sed -E 's#^.*/workloadIdentityPools/([^/]+)/providers/.*$#\1#' <<<"$provider")" \
  --format='value(attributeCondition)')"
for required_claim in \
  "assertion.repository == \"$repo\"" \
  "assertion.ref == \"refs/heads/main\"" \
  "assertion.workflow_ref == \"$repo/.github/workflows/deploy.yml@refs/heads/main\""; do
  [[ "$provider_condition" == *"$required_claim"* ]] || {
    echo "workload identity condition is missing an approved claim" >&2
    exit 2
  }
done

[[ "$deploy_service_account" == *@"$project_id".iam.gserviceaccount.com ]] || {
  echo "deploy service account is outside the approved project" >&2
  exit 2
}
gcloud iam service-accounts describe "$deploy_service_account" --project="$project_id" >/dev/null

echo "GitHub release governance preflight: PASS"
