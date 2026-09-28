locals {
  api_sso_secret_names = toset([
    "${local.prefix}-sso-internal-secret",
    "${local.prefix}-sso-approval-secret",
  ])
}

resource "google_secret_manager_secret" "api_sso" {
  for_each  = var.enable_sso_secrets ? local.api_sso_secret_names : toset([])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "api_sso" {
  for_each  = var.enable_sso_secrets ? local.api_sso_secret_names : toset([])
  project   = var.project_id
  secret_id = google_secret_manager_secret.api_sso[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
