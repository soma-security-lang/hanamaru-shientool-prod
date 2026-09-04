terraform {
  required_version = ">= 1.9.0"

  # The bucket and prefix are supplied by the release command so this module
  # stays reusable without committing project-specific state coordinates.
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.1"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}
