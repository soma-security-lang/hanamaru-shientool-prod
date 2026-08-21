#!/usr/bin/env bash
set -Eeuo pipefail

project_id="${GCP_PROJECT_ID:-monocle-503402}"
region="${GCP_REGION:-asia-northeast1}"
primary="${PRIMARY_INSTANCE:-hanamaru-pilot-postgres}"
replica="${PROMOTION_CANDIDATE:-hanamaru-pilot-postgres-replica}"
api_ready_url="${API_READY_URL:-https://hanamaru-pilot-api-tpqjzqidwa-an.a.run.app/health/ready}"
gcloud_cmd=(gcloud --configuration=default --project="$project_id")

primary_json="$("${gcloud_cmd[@]}" sql instances describe "$primary" --format=json)"
replica_json="$("${gcloud_cmd[@]}" sql instances describe "$replica" --format=json)"
primary_connection="$(jq -er '.connectionName' <<<"$primary_json")"

jq -e '.state=="RUNNABLE" and .settings.availabilityType=="ZONAL"' <<<"$primary_json" >/dev/null
jq -e --arg full "projects/$project_id/instances/$primary" --arg qualified "$project_id:$primary" --arg short "$primary" '(.state=="RUNNABLE") and (.settings.availabilityType=="REGIONAL") and (.masterInstanceName==$full or .masterInstanceName==$qualified or .masterInstanceName==$short) and (.gceZone != .secondaryGceZone) and (.secondaryGceZone != null)' <<<"$replica_json" >/dev/null

running_operations="$({ "${gcloud_cmd[@]}" sql operations list --instance="$primary" --filter='status!=DONE' --format=json; "${gcloud_cmd[@]}" sql operations list --instance="$replica" --filter='status!=DONE' --format=json; } | jq -s 'add|length')"
[[ "$running_operations" -eq 0 ]] || { echo "Cloud SQL operation is still running" >&2; exit 2; }

latest_backup="$("${gcloud_cmd[@]}" sql backups list --instance="$primary" --limit=1 --sort-by=~startTime --format=json | jq -e '.[0]')"
jq -e '.status=="SUCCESSFUL" and ((now-(.endTime|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)) <= 86400)' <<<"$latest_backup" >/dev/null

end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "$(uname -s)" == "Darwin" ]]; then start="$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)"; else start="$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"; fi
access_token="$("${gcloud_cmd[@]}" auth print-access-token)"
lag_response="$(curl -fsS -G -H "Authorization: Bearer $access_token" "https://monitoring.googleapis.com/v3/projects/$project_id/timeSeries" \
  --data-urlencode "filter=metric.type=\"cloudsql.googleapis.com/database/replication/replica_lag\" AND resource.labels.database_id=\"$project_id:$replica\"" \
  --data-urlencode "interval.startTime=$start" --data-urlencode "interval.endTime=$end" --data-urlencode 'view=FULL')"
lag="$(jq -er '[.timeSeries[]?.points[]?|{t:.interval.endTime,v:(.value.doubleValue//.value.int64Value|tonumber)}]|sort_by(.t)|last|select(.v==0)|.v' <<<"$lag_response")"

health="$(curl -fsS "$api_ready_url")"
jq -e '.status=="ready" and .database=="ok" and .providers=="gcp"' <<<"$health" >/dev/null

clients=(hanamaru-pilot-api hanamaru-pilot-worker)
jobs=(hanamaru-pilot-database-migrate hanamaru-pilot-database-provision-roles hanamaru-pilot-database-bootstrap hanamaru-pilot-content-import)
client_count=0
for service in "${clients[@]}"; do
  service_json="$("${gcloud_cmd[@]}" run services describe "$service" --region="$region" --format=json)"
  jq -e --arg connection "$primary_connection" '[..|strings|select(.==$connection)]|length>0' <<<"$service_json" >/dev/null
  client_count=$((client_count+1))
done
for job in "${jobs[@]}"; do
  job_json="$("${gcloud_cmd[@]}" run jobs describe "$job" --region="$region" --format=json)"
  jq -e --arg connection "$primary_connection" '[..|strings|select(.==$connection)]|length>0' <<<"$job_json" >/dev/null
  client_count=$((client_count+1))
done

jq -n \
  --arg status PASS \
  --arg primaryAvailability "$(jq -r '.settings.availabilityType' <<<"$primary_json")" \
  --arg replicaAvailability "$(jq -r '.settings.availabilityType' <<<"$replica_json")" \
  --arg primaryZone "$(jq -r '.gceZone' <<<"$replica_json")" \
  --arg secondaryZone "$(jq -r '.secondaryGceZone' <<<"$replica_json")" \
  --argjson lagSeconds "$lag" \
  --arg backupStatus "$(jq -r '.status' <<<"$latest_backup")" \
  --argjson clientsOnPrimary "$client_count" \
  '{status:$status,mutationPerformed:false,primaryAvailability:$primaryAvailability,promotionCandidate:{availability:$replicaAvailability,zones:[$primaryZone,$secondaryZone],lagSeconds:$lagSeconds},latestBackup:$backupStatus,clientsOnCurrentPrimary:$clientsOnPrimary}'
