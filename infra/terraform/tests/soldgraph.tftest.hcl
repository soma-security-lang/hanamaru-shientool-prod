# Provider mocks: no GCP API calls, state backend or real credentials.
# Run with: terraform test -var-file=terraform.tfvars.example -filter=tests/soldgraph.tftest.hcl
mock_provider "google" {}

variables {
  # Deliberately invalid service credentials with valid shape for local mocks.
  google_picker_api_key              = "AIza${join("", [for index in range(35) : "0"])}"
  identity_platform_api_key          = "AIza${join("", [for index in range(35) : "0"])}"
  initial_organization_id            = "00000000-0000-4000-8000-000000000001"
  initial_branch_id                  = "00000000-0000-4000-8000-000000000011"
  initial_manager_user_id            = "00000000-0000-4000-8000-000000000101"
  content_import_owner_membership_id = "00000000-0000-4000-8000-000000000101"
}

run "default_off" {
  command = plan
  assert {
    condition     = length(google_secret_manager_secret.soldgraph) == 0 && length(google_secret_manager_secret_iam_member.soldgraph_worker) == 0
    error_message = "Default must not create Soldgraph secrets or grants."
  }
  assert {
    condition     = one([for env in google_cloud_run_v2_service.worker.template[0].containers[0].env : env.value if env.name == "SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS"]) == "false"
    error_message = "Default Worker must prohibit external requests."
  }
}

run "incomplete_activation_rejected" {
  command = plan
  variables {
    enable_soldgraph_runtime = true
  }
  expect_failures = [google_cloud_run_v2_service.worker]
}

run "explicit_binding" {
  command = plan
  variables {
    enable_soldgraph_secrets = true
    enable_soldgraph_runtime = true
    soldgraph_account_id     = "00000000-0000-4000-8000-000000000067"
    soldgraph_secret_version = "7"
  }
  assert {
    condition     = length(google_secret_manager_secret.soldgraph) == 1 && length(google_secret_manager_secret_iam_member.soldgraph_worker) == 1
    error_message = "Explicit activation requires exactly one Worker-only secret grant."
  }
  assert {
    condition     = one([for env in google_cloud_run_v2_service.worker.template[0].containers[0].env : env.value_source[0].secret_key_ref[0].version if env.name == "SOLDGRAPH_API_KEY"]) == "7"
    error_message = "Worker must use the approved pinned secret version."
  }
  assert {
    condition     = alltrue([for env in google_cloud_run_v2_service.api.template[0].containers[0].env : !contains(["SOLDGRAPH_API_KEY", "SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS"], env.name)])
    error_message = "API must not receive Soldgraph credentials or communication permission."
  }
  assert {
    condition     = one([for env in google_cloud_run_v2_service.api.template[0].containers[0].env : env.value if env.name == "SOLDGRAPH_ACCOUNT_ID"]) == var.soldgraph_account_id
    error_message = "API and Worker must reserve against the same internal account."
  }
}

run "floating_secret_rejected" {
  command = plan
  variables {
    soldgraph_secret_version = "latest"
  }
  expect_failures = [var.soldgraph_secret_version]
}
