variable "project_id" {
  type        = string
  description = "Existing GCP project. No default prevents cross-project apply."
}
variable "region" {
  type    = string
  default = "asia-northeast1"
}
variable "environment" {
  type    = string
  default = "pilot"
  validation {
    condition     = contains(["dev", "staging", "pilot", "prod"], var.environment)
    error_message = "environment must be dev, staging, pilot, or prod"
  }
}
variable "web_image" {
  type = string
  validation {
    condition     = strcontains(var.web_image, "@sha256:")
    error_message = "web_image must be digest pinned"
  }
}
variable "api_image" {
  type = string
  validation {
    condition     = strcontains(var.api_image, "@sha256:")
    error_message = "api_image must be digest pinned"
  }
}
variable "worker_image" {
  type = string
  validation {
    condition     = strcontains(var.worker_image, "@sha256:")
    error_message = "worker_image must be digest pinned"
  }
}
variable "initial_organization_id" {
  type        = string
  description = "Approved organization UUID used only by the explicit PoC content import job. The organization row must already exist."
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.initial_organization_id))
    error_message = "initial_organization_id must be a UUID"
  }
}
variable "content_import_owner_membership_id" {
  type        = string
  description = "Pre-approved organization-scoped initial manager membership UUID. Production bootstrap must create this exact ID before the PoC import job runs."
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.content_import_owner_membership_id))
    error_message = "content_import_owner_membership_id must be a UUID"
  }
}
variable "initial_branch_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.initial_branch_id))
    error_message = "initial_branch_id must be a UUID"
  }
}
variable "initial_manager_user_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.initial_manager_user_id))
    error_message = "initial_manager_user_id must be a UUID"
  }
}
variable "initial_organization_key" { type = string }
variable "initial_organization_name" { type = string }
variable "initial_branch_key" { type = string }
variable "initial_branch_name" { type = string }
variable "initial_manager_display_name" { type = string }
variable "retention_days" {
  type    = object({ pdf = number, audio = number, video = number, transcript = number, review = number, audit = number })
  default = { pdf = 180, audio = 90, video = 365, transcript = 180, review = 180, audit = 365 }
  validation {
    condition     = alltrue([for days in values(var.retention_days) : days >= 1 && days <= 3650])
    error_message = "retention_days values must be between 1 and 3650"
  }
}
variable "pilot_content_ai_enabled" {
  type        = bool
  description = "Explicit limited-operation decision. false keeps all review-required PoC content out of AI grounding."
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "database_availability_type" {
  type        = string
  default     = "REGIONAL"
  description = "Cloud SQL availability. Existing ZONAL instances must only move to REGIONAL in an explicit restart or database-cutover maintenance gate."
  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.database_availability_type)
    error_message = "database_availability_type must be ZONAL or REGIONAL"
  }
}
variable "database_tier" {
  type        = string
  default     = "db-custom-2-7680"
  description = "Cloud SQL machine tier. Existing instances must change tier only in an explicit database maintenance gate."
}
variable "database_read_replica_enabled" {
  type        = bool
  default     = false
  description = "Creates a same-region read replica without changing the primary instance. This improves recovery options but is not automatic failover HA."
}
variable "database_read_replica_tier" {
  type        = string
  default     = "db-custom-1-3840"
  description = "Machine tier for the optional same-region read replica."
}
variable "database_read_replica_availability_type" {
  type        = string
  default     = "REGIONAL"
  description = "Availability of the promotion candidate. REGIONAL can be configured while the current primary keeps serving traffic."
  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.database_read_replica_availability_type)
    error_message = "database_read_replica_availability_type must be ZONAL or REGIONAL"
  }
}
variable "database_ssl_mode" {
  type        = string
  default     = "ENCRYPTED_ONLY"
  description = "Cloud SQL SSL mode. Existing instances must tighten this only after runtime connection verification."
  validation {
    condition     = contains(["ALLOW_UNENCRYPTED_AND_ENCRYPTED", "ENCRYPTED_ONLY", "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"], var.database_ssl_mode)
    error_message = "database_ssl_mode is not supported"
  }
}
variable "database_settings_deletion_protection_enabled" {
  type    = bool
  default = true
}
variable "database_maintenance_window_enabled" {
  type        = bool
  default     = true
  description = "Adds the approved Monday 03:00 JST maintenance window (Sunday 18:00 UTC). Existing instances use a separate non-disruptive change gate."
}
variable "allow_public_web" {
  type    = bool
  default = false
}
variable "allow_public_stage_web" {
  type        = bool
  default     = false
  description = "Expose only the fixed authenticated Green-test Web service. Enable explicitly after its Identity Platform domain, API-key referrers and Storage CORS are registered."
}
variable "allow_public_api" {
  type    = bool
  default = false
}
variable "schedulers_paused" {
  type        = bool
  default     = true
  description = "Keep dispatch, retention and operations schedulers paused until migration, bootstrap and content import have succeeded."
}
variable "cors_origins" {
  type = string
}
variable "firebase_hosting_origin" {
  type        = string
  default     = "https://monocle-503402.firebaseapp.com"
  description = "First-party Firebase Hosting origin used for production Google sign-in."
  validation {
    condition     = can(regex("^https://[a-z0-9-]+\\.firebaseapp\\.com$", var.firebase_hosting_origin))
    error_message = "firebase_hosting_origin must be an HTTPS firebaseapp.com origin without a path"
  }
}
variable "web_api_base_url" {
  type        = string
  description = "Browser-visible API base URL embedded into the Web image at build time."
  validation {
    condition     = can(regex("^https://[^/]+(?:/[^?#]*)?/api/v1$", var.web_api_base_url))
    error_message = "web_api_base_url must be an HTTPS URL ending in /api/v1"
  }
}
variable "google_client_id" {
  type        = string
  description = "Google Identity Services and Drive OAuth Web client ID. This value is public and must be embedded into the Web image at build time."
  validation {
    condition     = can(regex("^[0-9]+-[a-zA-Z0-9_-]+\\.apps\\.googleusercontent\\.com$", var.google_client_id))
    error_message = "google_client_id must be a Google OAuth Web client ID"
  }
}
variable "google_cloud_project_number" {
  type        = string
  description = "Numeric project number used by Google Picker setAppId and embedded into the Web image."
  validation {
    condition     = can(regex("^[0-9]{6,20}$", var.google_cloud_project_number))
    error_message = "google_cloud_project_number must be numeric"
  }
}
variable "google_picker_api_key" {
  type        = string
  sensitive   = true
  description = "Browser-restricted Google Picker API key embedded into the Web image at build time."
  validation {
    condition     = can(regex("^AIza[0-9A-Za-z_-]{35}$", var.google_picker_api_key))
    error_message = "google_picker_api_key must use the Google API key format"
  }
}
variable "identity_platform_api_key" {
  type        = string
  sensitive   = true
  description = "Browser-restricted Identity Platform API key embedded into the Web image."
  validation {
    condition     = can(regex("^AIza[0-9A-Za-z_-]{35}$", var.identity_platform_api_key))
    error_message = "identity_platform_api_key must use the Google API key format"
  }
}
variable "identity_platform_auth_domain" {
  type        = string
  description = "Identity Platform auth domain embedded into the Web image."
  validation {
    condition     = can(regex("^[a-z0-9.-]+$", var.identity_platform_auth_domain))
    error_message = "identity_platform_auth_domain must be a hostname"
  }
}
variable "google_drive_redirect_uri" {
  type        = string
  description = "GIS authorization-code popup redirect URI. It must be the exact Web origin, without a path."
  validation {
    condition     = can(regex("^https://[^/]+$", var.google_drive_redirect_uri))
    error_message = "google_drive_redirect_uri must be an HTTPS origin without a path"
  }
}
variable "worker_task_url" {
  type        = string
  description = "Private Worker base URL ending in /internal/tasks"
  validation {
    condition     = can(regex("^https://[^/]+/internal/tasks$", var.worker_task_url))
    error_message = "worker_task_url must be an HTTPS URL ending in /internal/tasks"
  }
}
variable "vertex_model" {
  type    = string
  default = "gemini-2.5-flash"
}
variable "vertex_location" {
  type    = string
  default = "asia-northeast1"
}
variable "speech_location" {
  type    = string
  default = "us"
  validation {
    condition     = contains(["asia-northeast1", "us"], var.speech_location)
    error_message = "speech_location must be asia-northeast1 or us"
  }
}
variable "speech_model" {
  type    = string
  default = "chirp_3"
  validation {
    condition     = var.speech_model == "chirp_3"
    error_message = "speech_model must be chirp_3"
  }
}
variable "token_encryption_key_version" {
  type        = string
  description = "Non-secret version label stored with encrypted Drive refresh tokens."
  validation {
    condition     = can(regex("^[a-zA-Z0-9._-]{1,64}$", var.token_encryption_key_version))
    error_message = "token_encryption_key_version must be a short stable label"
  }
}
variable "monthly_budget_jpy" {
  type        = number
  default     = 30000
  description = "Monthly project budget in JPY. It never stops the service automatically."
  validation {
    condition     = var.monthly_budget_jpy >= 1000
    error_message = "monthly_budget_jpy must be at least 1000"
  }
}
variable "billing_account_id" {
  type        = string
  description = "Billing account ID used by the project budget. Explicit input avoids ADC quota-project ambiguity."
  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the Google Cloud billing account ID format"
  }
}
variable "alert_notification_emails" {
  type        = set(string)
  default     = []
  description = "Verified GCP Project Owner email addresses used by operational alerts."
  validation {
    condition     = alltrue([for address in var.alert_notification_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", address))])
    error_message = "alert_notification_emails must contain valid email addresses"
  }
}

check "production_alert_recipients" {
  assert {
    condition     = !contains(["pilot", "prod"], var.environment) || length(var.alert_notification_emails) > 0
    error_message = "pilot/prod requires at least one verified GCP Project Owner alert email"
  }
}

check "google_oauth_project_contract" {
  assert {
    condition     = startswith(var.google_client_id, "${var.google_cloud_project_number}-")
    error_message = "google_client_id must belong to google_cloud_project_number"
  }
}

check "web_origin_contract" {
  assert {
    condition     = contains(split(",", var.cors_origins), var.google_drive_redirect_uri)
    error_message = "cors_origins must include the exact Google Drive popup/Web origin"
  }
}
