# Opt-in infrastructure only. No API key value or version is created by Terraform.
variable "enable_soldgraph_secrets" {
  type        = bool
  default     = false
  description = "Create an empty Worker-only Soldgraph secret container; does not enable requests."
}
variable "enable_soldgraph_runtime" {
  type        = bool
  default     = false
  description = "Explicitly permit Worker external requests after approved account, budgets and secret setup."
}
variable "soldgraph_account_id" {
  type        = string
  default     = ""
  description = "Internal shared-account UUID, not an API credential."
  validation {
    condition     = var.soldgraph_account_id == "" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.soldgraph_account_id))
    error_message = "soldgraph_account_id must be an internal UUID."
  }
}
variable "soldgraph_secret_version" {
  type        = string
  default     = ""
  description = "Approved numeric Secret Manager version. Never latest."
  validation {
    condition     = var.soldgraph_secret_version == "" || can(regex("^[1-9][0-9]*$", var.soldgraph_secret_version))
    error_message = "soldgraph_secret_version must be a pinned positive numeric version."
  }
}

resource "google_secret_manager_secret" "soldgraph" {
  count     = var.enable_soldgraph_secrets ? 1 : 0
  secret_id = "${local.prefix}-soldgraph-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "soldgraph_worker" {
  count     = var.enable_soldgraph_secrets ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.soldgraph[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
