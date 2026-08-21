output "web_uri" {
  value = google_cloud_run_v2_service.web.uri
}
output "stage_web_uri" {
  value       = google_cloud_run_v2_service.stage_web.uri
  description = "Fixed authenticated Green-test origin. It must be authorized once before release E2E."
}
output "api_uri" {
  value = google_cloud_run_v2_service.api.uri
}
output "worker_uri" {
  value     = google_cloud_run_v2_service.worker.uri
  sensitive = true
}
output "database_instance" {
  value = google_sql_database_instance.app.connection_name
}
output "database_read_replica" {
  value = try(google_sql_database_instance.read_replica[0].connection_name, null)
}
output "private_bucket" {
  value = google_storage_bucket.private.name
}
output "artifact_repository" {
  value = google_artifact_registry_repository.app.id
}
output "database_migration_job" {
  value = google_cloud_run_v2_job.database_migrate.name
}
output "content_import_job" {
  value = google_cloud_run_v2_job.content_import.name
}
