locals {
  prefix                 = "hanamaru-${var.environment}"
  stage_web_service_name = "hanamaru-${var.environment}-stage-web"
  services = toset([
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "containeranalysis.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "drive.googleapis.com",
    "identitytoolkit.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "picker.googleapis.com",
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "speech.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ])
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each           = local.services
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = local.prefix
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

locals {
  cloud_build_service_account = "${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  cloud_build_service_agent   = "service-${data.google_project.current.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${local.cloud_build_service_account}"
}

resource "google_storage_bucket_iam_member" "cloud_build_source_reader" {
  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.cloud_build_service_account}"
}

resource "google_storage_bucket_iam_member" "cloud_build_artifact_writer" {
  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${local.cloud_build_service_account}"
}

resource "google_project_iam_member" "cloud_build_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${local.cloud_build_service_account}"
}

resource "google_project_iam_member" "cloud_build_verification_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${local.cloud_build_service_agent}"
}

resource "google_compute_network" "app" {
  name                    = "${local.prefix}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "app" {
  name                     = "${local.prefix}-subnet"
  network                  = google_compute_network.app.id
  region                   = var.region
  ip_cidr_range            = "10.52.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "sql" {
  name          = "${local.prefix}-sql-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.app.id
}

resource "google_service_networking_connection" "sql" {
  network                 = google_compute_network.app.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql.name]
}

resource "google_service_account" "web" {
  account_id   = "${local.prefix}-web"
  display_name = "Hanamaru Web"
}
resource "google_service_account" "api" {
  account_id   = "${local.prefix}-api"
  display_name = "Hanamaru API"
}
resource "google_service_account" "worker" {
  account_id   = "${local.prefix}-worker"
  display_name = "Hanamaru Worker and Dispatcher"
}
resource "google_service_account" "tasks" {
  account_id   = "${local.prefix}-tasks"
  display_name = "Hanamaru Cloud Tasks caller"
}
resource "google_service_account" "scheduler" {
  account_id   = "${local.prefix}-scheduler"
  display_name = "Hanamaru Outbox Scheduler"
}
resource "google_service_account" "migration" {
  account_id   = "${local.prefix}-migration"
  display_name = "Hanamaru Database Migration"
}

resource "google_sql_database_instance" "app" {
  name                = "${local.prefix}-postgres"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.database_tier
    availability_type           = var.database_availability_type
    deletion_protection_enabled = var.database_settings_deletion_protection_enabled
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    disk_size                   = 20
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00"
      transaction_log_retention_days = 7
    }
    dynamic "maintenance_window" {
      for_each = var.database_maintenance_window_enabled ? [1] : []
      content {
        day          = 7
        hour         = 18
        update_track = "stable"
      }
    }
    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.app.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = var.database_ssl_mode
    }
    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
  depends_on = [google_service_networking_connection.sql]
}

# The promotion candidate is HA independently from the current primary. Its
# reconfiguration does not interrupt primary traffic. Promoting it still needs
# a separate write-drain, zero-lag and Cloud Run cutover gate.
resource "google_sql_database_instance" "read_replica" {
  count                = var.database_read_replica_enabled ? 1 : 0
  name                 = "${local.prefix}-postgres-replica"
  database_version     = "POSTGRES_16"
  region               = var.region
  master_instance_name = google_sql_database_instance.app.name
  deletion_protection  = true

  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.database_read_replica_tier
    availability_type           = var.database_read_replica_availability_type
    deletion_protection_enabled = true
    disk_type                   = "PD_SSD"
    disk_autoresize             = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.app.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = var.database_ssl_mode
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }

  depends_on = [google_service_networking_connection.sql]
}

resource "google_sql_database" "app" {
  name     = "hanamaru"
  instance = google_sql_database_instance.app.name
}

resource "google_storage_bucket" "private" {
  name                        = "${var.project_id}-${local.prefix}-private"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  cors {
    origin          = distinct(concat(split(",", var.cors_origins), [google_cloud_run_v2_service.stage_web.uri, var.firebase_hosting_origin]))
    method          = ["GET", "HEAD", "PUT"]
    response_header = ["Content-Type", "ETag", "x-goog-generation", "x-goog-if-generation-match", "x-goog-meta-sha256"]
    max_age_seconds = 3600
  }
  lifecycle_rule {
    condition {
      age            = 1
      matches_prefix = ["local-validation/vertex-input/", "local-validation/stt-input/"]
    }
    action {
      type = "Delete"
    }
  }
  # Only temporary namespaces may age out noncurrent generations automatically.
  # Business objects are write-once and every generation is deleted exclusively by
  # the application after its Legal Hold check and durable deletion fence succeed.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 1
      matches_prefix             = ["local-validation/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_cloud_tasks_queue" "jobs" {
  name     = "${local.prefix}-jobs"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 20
    max_dispatches_per_second = 10
  }
  retry_config {
    max_attempts       = 5
    max_retry_duration = "3600s"
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 5
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "database_url_api" {
  secret_id = "${local.prefix}-database-url-api"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "database_url_worker" {
  secret_id = "${local.prefix}-database-url-worker"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "database_url_migrator" {
  secret_id = "${local.prefix}-database-url-migrator"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "token_key" {
  secret_id = "${local.prefix}-token-encryption-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "oauth_client_secret" {
  secret_id = "${local.prefix}-oauth-client-secret"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "identity_platform_api_key" {
  secret_id = "${local.prefix}-identity-platform-api-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "picker_api_key" {
  secret_id = "${local.prefix}-picker-api-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "initial_manager_email" {
  secret_id = "${local.prefix}-initial-manager-email"
  replication {
    auto {}
  }
}

resource "google_cloud_run_v2_service" "api" {
  name                 = "${local.prefix}-api"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.allow_public_api
  deletion_protection  = var.deletion_protection
  template {
    labels = {
      deployment-fingerprint = substr(sha256(var.api_image), 0, 16)
    }
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = var.environment == "prod" ? 1 : 0
      max_instance_count = 20
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.app.name
        subnetwork = google_compute_subnetwork.app.name
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.app.connection_name]
      }
    }
    containers {
      image = var.api_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "1Gi" }
        cpu_idle = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PROVIDER_MODE"
        value = "gcp"
      }
      env {
        name  = "ALLOW_DEV_AUTH"
        value = "false"
      }
      env {
        name  = "IDENTITY_PLATFORM_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "GCS_PRIVATE_BUCKET"
        value = google_storage_bucket.private.name
      }
      env {
        name  = "STT_INPUT_BUCKET"
        value = google_storage_bucket.private.name
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.jobs.name
      }
      env {
        name  = "WORKER_TASK_URL"
        value = var.worker_task_url
      }
      env {
        name  = "TASK_SERVICE_ACCOUNT"
        value = google_service_account.tasks.email
      }
      env {
        name  = "VERTEX_AI_MODEL"
        value = var.vertex_model
      }
      env {
        name  = "VERTEX_LOCATION"
        value = var.vertex_location
      }
      env {
        name  = "SPEECH_LOCATION"
        value = var.speech_location
      }
      env {
        name  = "SPEECH_MODEL"
        value = var.speech_model
      }
      env {
        name  = "CORS_ORIGINS"
        value = join(",", distinct(concat(split(",", var.cors_origins), [google_cloud_run_v2_service.stage_web.uri, var.firebase_hosting_origin])))
      }
      env {
        name  = "GOOGLE_DRIVE_CLIENT_ID"
        value = var.google_client_id
      }
      env {
        name  = "GOOGLE_DRIVE_REDIRECT_URI"
        value = var.google_drive_redirect_uri
      }
      env {
        name  = "DATABASE_SSL"
        value = "disable"
      }
      env {
        name  = "DATABASE_CONTEXT_ROLE"
        value = "hanamaru_api"
      }
      env {
        name  = "DATABASE_SYSTEM_ROLE"
        value = "hanamaru_api_system"
      }
      env {
        name  = "TOKEN_ENCRYPTION_KEY_VERSION"
        value = var.token_encryption_key_version
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url_api.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "TOKEN_ENCRYPTION_KEY_B64"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.token_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_DRIVE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get { path = "/health/ready" }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 12
      }
      liveness_probe {
        http_get { path = "/health/live" }
        period_seconds = 10
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    # Release traffic is managed by the audited Blue/Green script. Terraform
    # owns service configuration but must never bypass staged image promotion.
    # Cloud Run also stamps the gcloud client, revision name, and immutable
    # release evidence labels. Those belong to the release record and must not
    # be removed by a later infrastructure apply.
    ignore_changes = [client, client_version, template[0].revision, template[0].labels, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "${local.prefix}-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  template {
    labels = {
      deployment-fingerprint = substr(sha256(var.worker_image), 0, 16)
    }
    service_account                  = google_service_account.worker.email
    timeout                          = "900s"
    max_instance_request_concurrency = 8
    scaling {
      min_instance_count = 0
      max_instance_count = 20
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.app.name
        subnetwork = google_compute_subnetwork.app.name
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.app.connection_name]
      }
    }
    containers {
      image = var.worker_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "2", memory = "2Gi" }
        cpu_idle = false
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PROVIDER_MODE"
        value = "gcp"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "GCS_PRIVATE_BUCKET"
        value = google_storage_bucket.private.name
      }
      env {
        name  = "STT_INPUT_BUCKET"
        value = google_storage_bucket.private.name
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.jobs.name
      }
      env {
        name  = "WORKER_TASK_URL"
        value = var.worker_task_url
      }
      env {
        name  = "TASK_SERVICE_ACCOUNT"
        value = google_service_account.tasks.email
      }
      env {
        name  = "VERTEX_AI_MODEL"
        value = var.vertex_model
      }
      env {
        name  = "VERTEX_LOCATION"
        value = var.vertex_location
      }
      env {
        name  = "SPEECH_LOCATION"
        value = var.speech_location
      }
      env {
        name  = "SPEECH_MODEL"
        value = var.speech_model
      }
      env {
        name  = "GOOGLE_DRIVE_CLIENT_ID"
        value = var.google_client_id
      }
      env {
        name  = "GOOGLE_DRIVE_REDIRECT_URI"
        value = var.google_drive_redirect_uri
      }
      env {
        name  = "DATABASE_SSL"
        value = "disable"
      }
      env {
        name  = "DATABASE_CONTEXT_ROLE"
        value = "hanamaru_worker"
      }
      env {
        name  = "DATABASE_SYSTEM_ROLE"
        value = "hanamaru_worker_system"
      }
      env {
        name  = "TOKEN_ENCRYPTION_KEY_VERSION"
        value = var.token_encryption_key_version
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url_worker.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "TOKEN_ENCRYPTION_KEY_B64"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.token_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_DRIVE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get { path = "/health/ready" }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 12
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    ignore_changes = [client, client_version, template[0].revision, template[0].labels, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job" "database_migrate" {
  name                = "${local.prefix}-database-migrate"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.migration.email
      timeout         = "900s"
      max_retries     = 0
      vpc_access {
        network_interfaces {
          network    = google_compute_network.app.name
          subnetwork = google_compute_subnetwork.app.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.app.connection_name]
        }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["apps/api/node_modules/@hanamaru/database/dist/cli-migrate.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "DATABASE_SSL"
          value = "disable"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url_migrator.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_job" "database_provision_roles" {
  name                = "${local.prefix}-database-provision-roles"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.migration.email
      timeout         = "900s"
      max_retries     = 0
      vpc_access {
        network_interfaces {
          network    = google_compute_network.app.name
          subnetwork = google_compute_subnetwork.app.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.app.connection_name] }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["apps/api/node_modules/@hanamaru/database/dist/cli-provision-runtime-roles.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "DATABASE_SSL"
          value = "disable"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url_migrator.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_job.database_migrate]
  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_job" "database_bootstrap" {
  name                = "${local.prefix}-database-bootstrap"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.migration.email
      timeout         = "900s"
      max_retries     = 0
      vpc_access {
        network_interfaces {
          network    = google_compute_network.app.name
          subnetwork = google_compute_subnetwork.app.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.app.connection_name] }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["apps/api/node_modules/@hanamaru/database/dist/cli-bootstrap-production.js", "--apply"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        dynamic "env" {
          for_each = {
            NODE_ENV                                = "production"
            DATABASE_SSL                            = "disable"
            BOOTSTRAP_ORGANIZATION_ID               = var.initial_organization_id
            BOOTSTRAP_ORGANIZATION_KEY              = var.initial_organization_key
            BOOTSTRAP_ORGANIZATION_NAME             = var.initial_organization_name
            BOOTSTRAP_BRANCH_ID                     = var.initial_branch_id
            BOOTSTRAP_BRANCH_KEY                    = var.initial_branch_key
            BOOTSTRAP_BRANCH_NAME                   = var.initial_branch_name
            BOOTSTRAP_INITIAL_MANAGER_USER_ID       = var.initial_manager_user_id
            BOOTSTRAP_INITIAL_MANAGER_MEMBERSHIP_ID = var.content_import_owner_membership_id
            BOOTSTRAP_INITIAL_MANAGER_DISPLAY_NAME  = var.initial_manager_display_name
            BOOTSTRAP_VERTEX_AI_MODEL               = var.vertex_model
            BOOTSTRAP_RETENTION_PDF_DAYS            = tostring(var.retention_days.pdf)
            BOOTSTRAP_RETENTION_AUDIO_DAYS          = tostring(var.retention_days.audio)
            BOOTSTRAP_RETENTION_VIDEO_DAYS          = tostring(var.retention_days.video)
            BOOTSTRAP_RETENTION_TRANSCRIPT_DAYS     = tostring(var.retention_days.transcript)
            BOOTSTRAP_RETENTION_REVIEW_DAYS         = tostring(var.retention_days.review)
            BOOTSTRAP_RETENTION_AUDIT_DAYS          = tostring(var.retention_days.audit)
            PILOT_CONTENT_AI_ENABLED                = tostring(var.pilot_content_ai_enabled)
          }
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "BOOTSTRAP_INITIAL_MANAGER_EMAIL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.initial_manager_email.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url_migrator.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_job.database_provision_roles]
  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_job" "content_import" {
  name                = "${local.prefix}-content-import"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.migration.email
      timeout         = "1800s"
      max_retries     = 0
      vpc_access {
        network_interfaces {
          network    = google_compute_network.app.name
          subnetwork = google_compute_subnetwork.app.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.app.connection_name]
        }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["apps/api/node_modules/@hanamaru/database/dist/cli-import-content.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "POC_CONTENT_PATH"
          value = "/app/apps/web/src/mocks/poc-content.json"
        }
        env {
          name  = "DATABASE_SSL"
          value = "disable"
        }
        env {
          name  = "CONTENT_IMPORT_ORGANIZATION_ID"
          value = var.initial_organization_id
        }
        env {
          name  = "CONTENT_IMPORT_OWNER_MEMBERSHIP_ID"
          value = var.content_import_owner_membership_id
        }
        env {
          name  = "PILOT_CONTENT_AI_ENABLED"
          value = tostring(var.pilot_content_ai_enabled)
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url_migrator.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_job.database_bootstrap]
  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_service" "web" {
  name                 = "${local.prefix}-web"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.allow_public_web
  deletion_protection  = var.deletion_protection
  template {
    service_account                  = google_service_account.web.email
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = var.environment == "prod" ? 1 : 0
      max_instance_count = 20
    }
    containers {
      image = var.web_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "NEXT_PUBLIC_API_BASE_URL"
        value = var.web_api_base_url
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY"
        value = var.identity_platform_api_key
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN"
        value = var.identity_platform_auth_domain
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY"
        value = var.google_picker_api_key
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER"
        value = var.google_cloud_project_number
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    ignore_changes = [client, client_version, template[0].revision, template[0].labels, template[0].containers[0].image]
  }
}

# Fixed browser-test origin. Unlike a traffic-tag URL this service URI remains
# stable across releases and can be authorized once in Identity Platform, API
# key referrer restrictions and Storage CORS. The release script deploys the
# exact production Web digest here and must pass authenticated E2E before the
# production Web service receives traffic.
resource "google_cloud_run_v2_service" "stage_web" {
  name                 = local.stage_web_service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.allow_public_stage_web
  deletion_protection  = var.deletion_protection
  template {
    service_account                  = google_service_account.web.email
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.web_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "NEXT_PUBLIC_API_BASE_URL"
        value = var.web_api_base_url
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY"
        value = var.identity_platform_api_key
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN"
        value = var.identity_platform_auth_domain
      }
      env {
        name  = "NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY"
        value = var.google_picker_api_key
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER"
        value = var.google_cloud_project_number
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    # The audited release script promotes the exact digest to this fixed origin.
    ignore_changes = [client, client_version, template[0].revision, template[0].labels, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "tasks_worker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks.email}"
}
resource "google_cloud_run_v2_service_iam_member" "scheduler_worker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "outbox_dispatch" {
  name             = "${local.prefix}-outbox-dispatch"
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Asia/Tokyo"
  paused           = var.schedulers_paused
  attempt_deadline = "60s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
    max_doublings        = 3
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/dispatch"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_worker]
}

resource "google_cloud_scheduler_job" "retention_scan" {
  name             = "${local.prefix}-retention-scan"
  region           = var.region
  schedule         = "15 2 * * *"
  time_zone        = "Asia/Tokyo"
  paused           = var.schedulers_paused
  attempt_deadline = "60s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/retention-scan"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_worker]
}

resource "google_cloud_scheduler_job" "operations_scan" {
  name             = "${local.prefix}-operations-scan"
  region           = var.region
  schedule         = "*/5 * * * *"
  time_zone        = "Asia/Tokyo"
  paused           = var.schedulers_paused
  attempt_deadline = "60s"
  retry_config {
    retry_count          = 2
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/operations-scan"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_worker]
}

resource "google_service_account_iam_member" "worker_can_use_task_identity" {
  service_account_id = google_service_account.tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_service_account_iam_member" "api_can_sign_upload_urls" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}
resource "google_service_account_iam_member" "worker_can_sign_audio_probe_urls" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "api_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}
resource "google_project_iam_member" "worker_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_project_iam_member" "migration_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migration.email}"
}
resource "google_project_iam_member" "worker_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_project_iam_member" "api_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}
resource "google_project_iam_member" "worker_speech" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_project_iam_member" "worker_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_storage_bucket_iam_member" "api_storage" {
  bucket = google_storage_bucket.private.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
resource "google_storage_bucket_iam_member" "worker_storage" {
  bucket = google_storage_bucket.private.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

locals {
  shared_secret_ids = toset([
    google_secret_manager_secret.token_key.secret_id,
    google_secret_manager_secret.oauth_client_secret.secret_id,
  ])
  api_secret_ids       = setunion(local.shared_secret_ids, toset([google_secret_manager_secret.database_url_api.secret_id]))
  worker_secret_ids    = setunion(local.shared_secret_ids, toset([google_secret_manager_secret.database_url_worker.secret_id]))
  migration_secret_ids = toset([google_secret_manager_secret.database_url_migrator.secret_id, google_secret_manager_secret.initial_manager_email.secret_id])
}
resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each  = local.api_secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
resource "google_secret_manager_secret_iam_member" "worker_secrets" {
  for_each  = local.worker_secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_secret_manager_secret_iam_member" "migration_secrets" {
  for_each  = local.migration_secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migration.email}"
}
resource "google_secret_manager_secret_iam_member" "cloud_build_browser_keys" {
  for_each = toset([
    google_secret_manager_secret.identity_platform_api_key.secret_id,
    google_secret_manager_secret.picker_api_key.secret_id,
  ])
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.cloud_build_service_account}"
}

resource "google_monitoring_notification_channel" "operations_email" {
  for_each     = var.alert_notification_emails
  display_name = "${local.prefix} operations ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
  force_delete = false
  depends_on   = [google_project_service.required]
}

locals {
  alert_channels = [for channel in google_monitoring_notification_channel.operations_email : channel.name]
}

resource "google_monitoring_uptime_check_config" "api_ready" {
  display_name     = "${local.prefix} API readiness"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["ASIA_PACIFIC", "USA", "EUROPE"]
  http_check {
    path         = "/health/ready"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "api_uptime" {
  display_name          = "${local.prefix} API health check failed"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "API readiness unavailable"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api_ready.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_TRUE"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  display_name          = "${local.prefix} API 5xx rate"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "API 5xx responses"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${google_cloud_run_v2_service.api.name}\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "queue_backlog" {
  display_name          = "${local.prefix} task queue backlog"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Queue depth above 100"
    condition_threshold {
      filter          = "metric.type=\"cloudtasks.googleapis.com/queue/depth\" AND resource.type=\"cloud_tasks_queue\" AND resource.label.queue_id=\"${google_cloud_tasks_queue.jobs.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 100
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "sql_cpu" {
  display_name          = "${local.prefix} Cloud SQL CPU high"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Cloud SQL CPU above 80 percent"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${var.project_id}:${google_sql_database_instance.app.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "worker_failed_jobs" {
  name   = "${local.prefix}-worker-failed-jobs"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.jobStatus=\"failed\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "worker_retry_wait" {
  name   = "${local.prefix}-worker-retry-wait"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.jobStatus=\"retry_wait\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "worker_failures" {
  display_name          = "${local.prefix} failed jobs"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "At least one terminal failed job"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_failed_jobs.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "worker_retries" {
  display_name          = "${local.prefix} repeated job retries"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Retry wait events continue for 30 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_retry_wait.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "1800s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "sql_connections" {
  display_name          = "${local.prefix} Cloud SQL connections high"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Connections above 80"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${var.project_id}:${google_sql_database_instance.app.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 80
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "sql_disk" {
  display_name          = "${local.prefix} Cloud SQL disk utilization"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Disk utilization above 80 percent"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${var.project_id}:${google_sql_database_instance.app.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "900s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "sql_replica_lag" {
  count                 = var.database_read_replica_enabled ? 1 : 0
  display_name          = "${local.prefix} Cloud SQL replica lag"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Read replica lag above 60 seconds"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/replication/replica_lag\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${var.project_id}:${google_sql_database_instance.read_replica[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 60
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "scheduler_failures" {
  name   = "${local.prefix}-scheduler-failures"
  filter = "resource.type=\"cloud_scheduler_job\" AND resource.labels.project_id=\"${var.project_id}\" AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "scheduler_failures" {
  display_name          = "${local.prefix} scheduler failures"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Scheduler execution error"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.scheduler_failures.name}\" AND resource.type=\"cloud_scheduler_job\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "auth_failures" {
  name   = "${local.prefix}-auth-failures"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.api.name}\" AND jsonPayload.authFailure=true"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "auth_failures" {
  display_name          = "${local.prefix} authentication failures"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Authentication failures above 30 per minute"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.auth_failures.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.5
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_logging_metric" "provider_failures" {
  name   = "${local.prefix}-provider-failures"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND (jsonPayload.jobStatus=\"failed\" OR jsonPayload.jobStatus=\"retry_wait\") AND (jsonPayload.jobType=\"transcribe\" OR jsonPayload.jobType=\"review\" OR jsonPayload.jobType=\"preparation\" OR jsonPayload.jobType=\"pdf_extract\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key        = "job_type"
      value_type = "STRING"
    }
  }
  label_extractors = {
    job_type = "EXTRACT(jsonPayload.jobType)"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "provider_failures" {
  display_name          = "${local.prefix} Vertex or Speech failures"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Provider-backed job failures"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.provider_failures.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

# `/internal/operations-scan` emits only bounded operational metadata. These
# metrics deliberately filter on the strict failureClass enum and never ingest
# transcript text, model output, provider payloads or customer identifiers.
resource "google_logging_metric" "stt_stalled" {
  name   = "${local.prefix}-stt-stalled"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.operationalAlert=true AND (jsonPayload.failureClass=\"STT_HEARTBEAT_STALE\" OR jsonPayload.failureClass=\"STT_LRO_TIMEOUT\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "model_output_invalid" {
  name   = "${local.prefix}-model-output-invalid"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.operationalAlert=true AND jsonPayload.failureClass=\"MODEL_OUTPUT_INVALID\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "evidence_invalid" {
  name   = "${local.prefix}-evidence-invalid"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.operationalAlert=true AND jsonPayload.failureClass=\"EVIDENCE_INVALID\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "retry_limit_exceeded" {
  name   = "${local.prefix}-retry-limit-exceeded"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.operationalAlert=true AND jsonPayload.failureClass=\"RETRY_LIMIT_EXCEEDED\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "retry_wait_overdue" {
  name   = "${local.prefix}-retry-wait-overdue"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.operationalAlert=true AND jsonPayload.failureClass=\"RETRY_WAIT_OVERDUE\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "stt_stalled" {
  display_name          = "${local.prefix} STT processing stalled"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "STT heartbeat or Chirp 3 operation is stale"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.stt_stalled.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "model_output_invalid" {
  display_name          = "${local.prefix} AI model output invalid"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Vertex AI output failed its structured contract"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.model_output_invalid.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "evidence_invalid" {
  display_name          = "${local.prefix} AI evidence invalid"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "AI evidence does not resolve to stored segments"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.evidence_invalid.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "retry_limit_exceeded" {
  display_name          = "${local.prefix} worker retry limit exceeded"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "A job reached its terminal retry limit"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.retry_limit_exceeded.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_monitoring_alert_policy" "retry_wait_overdue" {
  display_name          = "${local.prefix} retry wait overdue"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "A retry_wait job is overdue by more than ten minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.retry_wait_overdue.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "ai_processing_ms" {
  name            = "${local.prefix}-ai-processing-ms"
  filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.jobStatus=\"succeeded\" AND (jsonPayload.jobType=\"review\" OR jsonPayload.jobType=\"preparation\" OR jsonPayload.jobType=\"pdf_extract\")"
  value_extractor = "EXTRACT(jsonPayload.processingMs)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 12
      growth_factor      = 2
      scale              = 1000
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "ai_latency" {
  display_name          = "${local.prefix} AI processing latency"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "AI p95 above five minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.ai_processing_ms.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 300000
      duration        = "900s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "ai_requests" {
  name   = "${local.prefix}-ai-requests"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.jobStatus=\"succeeded\" AND (jsonPayload.jobType=\"review\" OR jsonPayload.jobType=\"preparation\" OR jsonPayload.jobType=\"pdf_extract\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "ai_usage_spike" {
  display_name          = "${local.prefix} AI usage cost proxy spike"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "AI provider jobs above 180 per hour"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.ai_requests.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "900s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_logging_metric" "secret_access_failures" {
  name   = "${local.prefix}-secret-access-failures"
  filter = "resource.type=\"audited_resource\" AND protoPayload.serviceName=\"secretmanager.googleapis.com\" AND protoPayload.status.code!=0"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "sql_errors" {
  name   = "${local.prefix}-sql-errors"
  filter = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.app.name}\" AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "secret_access_failures" {
  display_name          = "${local.prefix} Secret Manager access failures"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Secret access denied or unavailable"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.secret_access_failures.name}\" AND resource.type=\"audited_resource\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "sql_errors" {
  display_name          = "${local.prefix} Cloud SQL errors and backup failures"
  combiner              = "OR"
  notification_channels = local.alert_channels
  conditions {
    display_name = "Cloud SQL error logs"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.sql_errors.name}\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "3600s" }
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${local.prefix} monthly ${var.monthly_budget_jpy} JPY"
  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }
  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.monthly_budget_jpy)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  threshold_rules { threshold_percent = 1.2 }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  all_updates_rule {
    monitoring_notification_channels = local.alert_channels
    enable_project_level_recipients  = true
    disable_default_iam_recipients   = false
  }
  depends_on = [google_project_service.required]
}
