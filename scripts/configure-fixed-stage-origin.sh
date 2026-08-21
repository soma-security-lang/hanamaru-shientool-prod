#!/usr/bin/env bash
set -Eeuo pipefail

project_id="${GCP_PROJECT_ID:-monocle-503402}"
region="${GCP_REGION:-asia-northeast1}"
stage_service="${STAGE_WEB_SERVICE:-hanamaru-pilot-stage-web}"
identity_api_key_resource="${IDENTITY_API_KEY_RESOURCE:-projects/823274085145/locations/global/keys/469596c9-02cb-4552-a079-ea595a9aaedb}"
picker_api_key_resource="${PICKER_API_KEY_RESOURCE:-projects/823274085145/locations/global/keys/f3e8c415-f54d-4aa5-a7ae-87059df7cba4}"
private_bucket="${PRIVATE_BUCKET:-monocle-503402-hanamaru-pilot-private}"
apply_change="${APPLY_FIXED_STAGE_ORIGIN:-false}"
state_dir="${STAGE_ORIGIN_STATE_DIR:-.artifacts/stage-origin/$(date -u +%Y%m%dT%H%M%SZ)}"
gcloud_cmd=(gcloud --configuration=default --project="$project_id")

[[ "$project_id" == monocle-503402 && "$region" == asia-northeast1 ]] || {
  echo "fixed Stage origin target must be monocle-503402 / asia-northeast1" >&2
  exit 2
}
[[ "$stage_service" == hanamaru-pilot-stage-web && "$private_bucket" == monocle-503402-hanamaru-pilot-private ]] || {
  echo "fixed Stage origin may modify only approved hanamaru-pilot resources" >&2
  exit 2
}

stage_origin="${STAGE_WEB_ORIGIN:-$("${gcloud_cmd[@]}" run services describe "$stage_service" --region="$region" --format='value(status.url)')}"
[[ "$stage_origin" =~ ^https://[a-z0-9.-]+$ ]] || {
  echo "fixed Stage Web origin must be an origin-only HTTPS URL" >&2
  exit 2
}
stage_domain="${stage_origin#https://}"
stage_referrer="${stage_origin}/*"

mkdir -p "$state_dir"
chmod 700 "$state_dir"
identity_before="$state_dir/identity-authorized-domains.before.json"
identity_after="$state_dir/identity-authorized-domains.expected.json"
identity_readback="$state_dir/identity-authorized-domains.readback.json"
identity_key_before="$state_dir/identity-key-referrers.before.json"
identity_key_after="$state_dir/identity-key-referrers.expected.json"
picker_key_before="$state_dir/picker-key-referrers.before.json"
picker_key_after="$state_dir/picker-key-referrers.expected.json"
cors_before="$state_dir/storage-cors.before.json"
cors_after="$state_dir/storage-cors.expected.json"

access_token="$("${gcloud_cmd[@]}" auth print-access-token)"
identity_url="https://identitytoolkit.googleapis.com/admin/v2/projects/${project_id}/config"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $access_token" -H "x-goog-user-project: $project_id" "$identity_url" |
  jq '{authorizedDomains:(.authorizedDomains // [] | unique | sort)}' > "$identity_before"
"${gcloud_cmd[@]}" services api-keys describe "$identity_api_key_resource" --format=json |
  jq '{allowedReferrers:(.restrictions.browserKeyRestrictions.allowedReferrers // [] | unique | sort)}' > "$identity_key_before"
"${gcloud_cmd[@]}" services api-keys describe "$picker_api_key_resource" --format=json |
  jq '{allowedReferrers:(.restrictions.browserKeyRestrictions.allowedReferrers // [] | unique | sort)}' > "$picker_key_before"
"${gcloud_cmd[@]}" storage buckets describe "gs://$private_bucket" --format=json |
  jq '(.cors_config // []) | map(.origin = ((.origin // []) | unique | sort))' > "$cors_before"
chmod 600 "$identity_before" "$identity_key_before" "$picker_key_before" "$cors_before"

jq --arg domain "$stage_domain" '.authorizedDomains += [$domain] | .authorizedDomains |= unique | .authorizedDomains |= sort' "$identity_before" > "$identity_after"
jq --arg referrer "$stage_referrer" '.allowedReferrers += [$referrer] | .allowedReferrers |= unique | .allowedReferrers |= sort' "$identity_key_before" > "$identity_key_after"
jq --arg referrer "$stage_referrer" '.allowedReferrers += [$referrer] | .allowedReferrers |= unique | .allowedReferrers |= sort' "$picker_key_before" > "$picker_key_after"
jq --arg origin "$stage_origin" 'if length == 0 then [{origin:[$origin],method:["GET","HEAD","PUT"],responseHeader:["Content-Type","ETag","x-goog-generation","x-goog-if-generation-match","x-goog-meta-sha256"],maxAgeSeconds:3600}] else map(.origin = (((.origin // []) + [$origin]) | unique | sort)) end' "$cors_before" > "$cors_after"
chmod 600 "$identity_after" "$identity_key_after" "$picker_key_after" "$cors_after"

summary(){
  jq -n \
    --arg mode "$1" --arg stageOrigin "$stage_origin" \
    --argjson identityChange "$(cmp -s "$identity_before" "$identity_after" && echo false || echo true)" \
    --argjson identityKeyChange "$(cmp -s "$identity_key_before" "$identity_key_after" && echo false || echo true)" \
    --argjson pickerKeyChange "$(cmp -s "$picker_key_before" "$picker_key_after" && echo false || echo true)" \
    --argjson storageCorsChange "$(cmp -s "$cors_before" "$cors_after" && echo false || echo true)" \
    '{status:$mode,stageOrigin:$stageOrigin,changes:{identityAuthorizedDomain:$identityChange,identityApiKeyReferrer:$identityKeyChange,pickerApiKeyReferrer:$pickerKeyChange,storageCors:$storageCorsChange}}'
}

if [[ "$apply_change" != true ]]; then
  summary "DRY_RUN"
  exit 0
fi

mutated=false
restore(){
  [[ "$mutated" == true ]] || return 0
  set +e
  local token
  token="$("${gcloud_cmd[@]}" auth print-access-token)"
  curl --fail --silent --show-error -X PATCH \
    -H "Authorization: Bearer $token" -H "x-goog-user-project: $project_id" \
    -H 'content-type: application/json' \
    --data-binary "@$identity_before" "${identity_url}?updateMask=authorizedDomains" >/dev/null
  "${gcloud_cmd[@]}" services api-keys update "$identity_api_key_resource" \
    --allowed-referrers="$(jq -r '.allowedReferrers | join(",")' "$identity_key_before")" --quiet >/dev/null
  "${gcloud_cmd[@]}" services api-keys update "$picker_api_key_resource" \
    --allowed-referrers="$(jq -r '.allowedReferrers | join(",")' "$picker_key_before")" --quiet >/dev/null
  "${gcloud_cmd[@]}" storage buckets update "gs://$private_bucket" --cors-file="$cors_before" --quiet >/dev/null
}
trap 'status=$?; trap - ERR INT TERM EXIT; if (( status != 0 )); then restore; fi; exit "$status"' ERR INT TERM EXIT

mutated=true
curl --fail --silent --show-error -X PATCH \
  -H "Authorization: Bearer $access_token" -H "x-goog-user-project: $project_id" \
  -H 'content-type: application/json' \
  --data-binary "@$identity_after" "${identity_url}?updateMask=authorizedDomains" >/dev/null
"${gcloud_cmd[@]}" services api-keys update "$identity_api_key_resource" \
  --allowed-referrers="$(jq -r '.allowedReferrers | join(",")' "$identity_key_after")" --quiet >/dev/null
"${gcloud_cmd[@]}" services api-keys update "$picker_api_key_resource" \
  --allowed-referrers="$(jq -r '.allowedReferrers | join(",")' "$picker_key_after")" --quiet >/dev/null
"${gcloud_cmd[@]}" storage buckets update "gs://$private_bucket" --cors-file="$cors_after" --quiet >/dev/null

access_token="$("${gcloud_cmd[@]}" auth print-access-token)"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $access_token" -H "x-goog-user-project: $project_id" "$identity_url" |
  jq '{authorizedDomains:(.authorizedDomains // [] | unique | sort)}' > "$identity_readback"
identity_referrers_readback="$("${gcloud_cmd[@]}" services api-keys describe "$identity_api_key_resource" --format=json | jq -c '.restrictions.browserKeyRestrictions.allowedReferrers // [] | unique | sort')"
picker_referrers_readback="$("${gcloud_cmd[@]}" services api-keys describe "$picker_api_key_resource" --format=json | jq -c '.restrictions.browserKeyRestrictions.allowedReferrers // [] | unique | sort')"
cors_readback="$("${gcloud_cmd[@]}" storage buckets describe "gs://$private_bucket" --format=json | jq -c '(.cors_config // []) | map(.origin = ((.origin // []) | unique | sort))')"

cmp -s "$identity_after" "$identity_readback"
[[ "$identity_referrers_readback" == "$(jq -c '.allowedReferrers' "$identity_key_after")" ]]
[[ "$picker_referrers_readback" == "$(jq -c '.allowedReferrers' "$picker_key_after")" ]]
[[ "$cors_readback" == "$(jq -c '.' "$cors_after")" ]]

mutated=false
trap - ERR INT TERM EXIT
summary "APPLIED_AND_VERIFIED"
