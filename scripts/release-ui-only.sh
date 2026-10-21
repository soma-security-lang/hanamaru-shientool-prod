#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/release-guard.sh"
source "$script_dir/release-tag.sh"
project=monocle-503402
region=asia-northeast1
account="${GCP_ACCOUNT:?Explicit approved existing GCP account is required}"
web=hanamaru-pilot-web
stage=hanamaru-pilot-stage-web
sha="$(git rev-parse HEAD)"
base="${UI_RELEASE_BASE_SHA:?Confirmed active product source SHA is required}"
image="${WEB_IMAGE:?Digest-pinned approved Web image is required}"
build="${BUILD_ID:?Successful Cloud Build ID is required}"
evidence="${UI_BROWSER_EVIDENCE:?Existing complete product-equivalent browser evidence is required}"
request_file="${UI_GATE_REQUEST_FILE:?Operator browser gate request path is required}"
status_file="${UI_GATE_STATUS_FILE:?Operator browser gate status path is required}"
drift_file="${UI_DRIFT_EVIDENCE:?Sanitized current Terraform drift evidence is required}"
state_dir="${UI_RELEASE_STATE_DIR:-.artifacts/ui-release/$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$image" =~ ^asia-northeast1-docker.pkg.dev/monocle-503402/hanamaru-pilot/web@sha256:[0-9a-f]{64}$ ]] || { echo 'Only the existing digest-pinned Web repository is permitted' >&2; exit 2; }
[[ "$(git remote get-url origin)" =~ ^https://github.com/soma-security-lang/hanamaru-shientool-prod(\.git)?$ ]] || { echo 'Unexpected origin repository' >&2; exit 2; }
git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]] || { echo 'Clean checkout required' >&2; exit 2; }
[[ "$(git ls-remote origin refs/heads/main | awk 'NR==1{print $1}')" == "$sha" ]] || { echo 'HEAD must equal real origin/main' >&2; exit 2; }
node "$script_dir/ui-only-eligibility.mjs" "$base" "$sha" "$evidence" >/dev/null
jq -e '.stage.authenticated and .stage.manager and .fixed.authenticated and .fixed.manager' "$status_file" >/dev/null || { echo 'Normal operator app login is required at both fixed origins' >&2; exit 4; }
jq -e --arg sha "$sha" '.status=="PASS" and .phase=="pre-release" and .sourceSha==$sha and .resourceChanges==0 and .mutationPerformed==false' "$drift_file" >/dev/null || { echo 'Current read-only Terraform drift gate is not satisfied' >&2; exit 4; }
gc=(gcloud --project="$project" --account="$account")
service_json(){ "${gc[@]}" run services describe "$1" --region="$region" --format='json(status.url,status.traffic)'; }
active_revision(){ service_json "$1" | jq -er '.status.traffic[]|select(.percent==100)|.revisionName'; }
source_of(){ "${gc[@]}" run revisions describe "$1" --region="$region" --format='json(metadata.labels)' | jq -er '.metadata.labels["source-commit"]'; }
image_of(){ "${gc[@]}" run revisions describe "$1" --region="$region" --format='value(status.imageDigest)'; }
assert_image(){ [[ "$(image_of "$1")" == *"${image##*@}"* ]] || { echo 'Revision/image digest mismatch' >&2; return 1; }; }
web_url="$(service_json "$web" | jq -er '.status.url')"
stage_url="$(service_json "$stage" | jq -er '.status.url')"
[[ "$web_url" == https://hanamaru-pilot-web-tpqjzqidwa-an.a.run.app && "$stage_url" == https://hanamaru-pilot-stage-web-tpqjzqidwa-an.a.run.app ]] || { echo 'Existing fixed origins required' >&2; exit 2; }
blue_web="$(active_revision "$web")"
blue_stage="$(active_revision "$stage")"
blue_api="$(active_revision hanamaru-pilot-api)"
blue_worker="$(active_revision hanamaru-pilot-worker)"
for revision in "$blue_web" "$blue_stage" "$blue_api" "$blue_worker"; do [[ "$(source_of "$revision")" == "$base" ]] || { echo 'Live product sources changed since compatibility review' >&2; exit 2; }; done
build_json="$("${gc[@]}" builds describe "$build" --region="$region" --format='json(status,results.images)')"
jq -e --arg tag "asia-northeast1-docker.pkg.dev/$project/hanamaru-pilot/web:$sha" --arg digest "${image##*@}" '.status=="SUCCESS" and any(.results.images[]; .name==$tag and .digest==$digest)' <<<"$build_json" >/dev/null
mkdir -p "$state_dir";chmod 700 "$state_dir"
node "$script_dir/ui-only-eligibility.mjs" "$base" "$sha" "$evidence" > "$state_dir/eligibility.json"
jq -n --arg web "$blue_web" --arg stage "$blue_stage" --arg api "$blue_api" --arg worker "$blue_worker" --arg sha "$sha" --arg image "$image" --arg build "$build" '{blue:{web:$web,stage:$stage,api:$api,worker:$worker},sourceSha:$sha,image:$image,buildId:$build}' > "$state_dir/before.json"
changed=false
rollback(){
  [[ "$changed" == true ]] || return 0
  local failed=0 service revision ok
  for service in "$stage" "$web"; do
    if [[ "$service" == "$stage" ]];then revision="$blue_stage";else revision="$blue_web";fi
    ok=false
    for attempt in 1 2 3; do
      if "${gc[@]}" run services update-traffic "$service" --region="$region" --to-revisions="$revision=100" --quiet >/dev/null;then ok=true;break;fi
    done
    [[ "$ok" == true ]] || failed=1
  done
  if (( failed ));then printf '{"status":"ROLLBACK_INCOMPLETE"}\n' > "$state_dir/ROLLBACK_INCOMPLETE.json";return 1;fi
}
release_guard_install
healthy(){
  local count=0
  for attempt in $(seq 1 60);do
    if curl --fail --silent --show-error "$1" >/dev/null;then count=$((count+1));else count=0;fi
    (( count>=3 )) && return 0
    sleep 5
  done
  return 1
}
no_errors(){
 local ids
 ids="$("${gc[@]}" logging read "resource.type=\"cloud_run_revision\" AND resource.labels.revision_name=\"$1\" AND severity>=ERROR" --limit=1 --format='value(insertId)')"
 [[ -z "$ids" ]] || { echo 'New revision ERROR log gate failed' >&2;return 1; }
}
backend_unchanged(){ [[ "$(active_revision hanamaru-pilot-api)" == "$blue_api" && "$(active_revision hanamaru-pilot-worker)" == "$blue_worker" ]]; }
ui_gate(){
 local phase="$1" nonce result
 nonce="$(node -e 'console.log(require("node:crypto").randomUUID())')"
 jq -n --arg phase "$phase" --arg id "$nonce" --arg sha "$sha" '{phase:$phase,id:$id,expectedSourceSha:$sha,readOnly:true}' > "$request_file"
 chmod 600 "$request_file"
 for attempt in $(seq 1 180);do
  result="$(jq -r --arg id "$nonce" --arg sha "$sha" --arg phase "$phase" 'if .lastGate.id!=$id then "WAIT" elif .lastGate.status=="PASS" and .lastGate.sourceSha==$sha and .lastGate.phase==$phase and .lastGate.businessMutations==0 and .lastGate.managerVerified==true and .lastGate.apiAnonymousStatus==401 then "PASS" else "FAIL" end' "$status_file")"
  if [[ "$result" == PASS ]];then jq '.lastGate' "$status_file" > "$state_dir/$phase-ui-gate.json";return 0;fi
  [[ "$result" != FAIL ]] || { echo 'Authenticated UI gate failed' >&2;return 1; }
  sleep 5
 done
 echo 'Authenticated browser gate timed out' >&2;return 1
}
tag="$(release_tag_from_commit "$sha")";validate_release_tag "$tag" "$web" "$stage"
for service in "$web" "$stage";do
  if service_json "$service" | jq -e --arg tag "$tag" 'any(.status.traffic[]; .tag==$tag)' >/dev/null;then
    echo 'A tagged UI candidate already exists; inspect its recorded outcome before retrying' >&2;exit 3
  fi
done
labels="source-commit=$sha,build-id=$build,release-id=ui-${sha:0:12}"
changed=true
"${gc[@]}" run deploy "$web" --region="$region" --image="$image" --no-traffic --tag="$tag" --labels="$labels" --quiet >/dev/null
green_web="$("${gc[@]}" run services describe "$web" --region="$region" --format='value(status.latestCreatedRevisionName)')"
assert_image "$green_web"
"${gc[@]}" run deploy "$stage" --region="$region" --image="$image" --no-traffic --tag="$tag" --labels="$labels" --quiet >/dev/null
green_stage="$("${gc[@]}" run services describe "$stage" --region="$region" --format='value(status.latestCreatedRevisionName)')"
assert_image "$green_stage"
"${gc[@]}" run services update-traffic "$stage" --region="$region" --to-revisions="$green_stage=100" --quiet >/dev/null
healthy "$stage_url/login"
ui_gate stage
no_errors "$green_stage"
for percent in 1 10 50 100;do
 backend_unchanged
 blue=$((100-percent));target="$green_web=$percent";(( blue==0 )) || target="$target,$blue_web=$blue"
 "${gc[@]}" run services update-traffic "$web" --region="$region" --to-revisions="$target" --quiet >/dev/null
 healthy "$web_url/login"
 if (( percent==50 ));then wait_seconds=1800;elif (( percent<100 ));then wait_seconds=900;else wait_seconds=0;fi
 while (( wait_seconds>0 ));do
  slice=55;(( wait_seconds>=slice )) || slice=$wait_seconds
  sleep "$slice";wait_seconds=$((wait_seconds-slice))
  healthy "$web_url/login";no_errors "$green_web";backend_unchanged
 done
 no_errors "$green_web"
 jq -n --argjson percent "$percent" --arg revision "$green_web" '{state:"observed",percent:$percent,revision:$revision}' > "$state_dir/progress.json"
done
healthy https://monocle-503402.firebaseapp.com/login
ui_gate fixed
backend_unchanged
assert_image "$green_stage";assert_image "$green_web"
no_errors "$green_stage";no_errors "$green_web"
# Post-release drift is supplied by the approved operator's real read-only plan.
# Missing approval/input never becomes an assumed zero-drift result.
drift_verified=false
for attempt in $(seq 1 180);do
 if jq -e --arg sha "$sha" '.status=="PASS" and .phase=="post-release" and .sourceSha==$sha and .resourceChanges==0 and .mutationPerformed==false' "$drift_file" >/dev/null;then drift_verified=true;break;fi
 sleep 5
done
[[ "$drift_verified" == true ]] || { echo 'Post-release Terraform drift gate not verified' >&2;exit 5; }
jq -n --arg sha "$sha" --arg image "$image" --arg web "$green_web" --arg stage "$green_stage" --arg build "$build" '{status:"PUBLISHED",sourceSha:$sha,image:$image,buildId:$build,webRevision:$web,stageRevision:$stage,traffic:100,apiWorkerDatabaseChanged:false}' > "$state_dir/result.json"
release_guard_clear
echo "UI release promoted to the existing fixed URL. Blue revisions retained."
