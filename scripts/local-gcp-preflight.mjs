#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const requiredServices = new Set([
  "speech.googleapis.com",
  "aiplatform.googleapis.com",
  "storage.googleapis.com",
  "drive.googleapis.com",
  "picker.googleapis.com",
]);

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing-${name}`);
  return value;
};

let stage = "adc-token";
try {
  const token = execFileSync("gcloud", ["auth", "application-default", "print-access-token", "--quiet"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!token) throw new Error("empty-token");

  const getJson = async (url) => {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!response.ok) throw new Error(`http-${response.status}`);
    return response.json();
  };

  const projectId = required("GCP_PROJECT_ID");
  stage = "project-read";
  const project = await getJson(`https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`);
  const projectNumber = String(project.projectNumber ?? "");
  if (project.projectId !== projectId || !/^\d{6,20}$/.test(projectNumber)) throw new Error("project-contract");
  if (projectNumber !== required("NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER")) throw new Error("picker-project-number");
  if (required("IDENTITY_PLATFORM_PROJECT_ID") !== projectId) throw new Error("identity-platform-project");
  if (!required("GOOGLE_DRIVE_CLIENT_ID").startsWith(`${projectNumber}-`)) throw new Error("drive-oauth-project-number");

  stage = "enabled-services-read";
  const enabled = new Set();
  let pageToken = "";
  do {
    const url = new URL(`https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services`);
    url.searchParams.set("filter", "state:ENABLED");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await getJson(url);
    for (const service of page.services ?? []) enabled.add(String(service.config?.name ?? ""));
    pageToken = String(page.nextPageToken ?? "");
  } while (pageToken);
  for (const service of requiredServices) if (!enabled.has(service)) throw new Error(`service-disabled-${service}`);

  stage = "stt-bucket-read";
  const bucket = required("STT_INPUT_BUCKET");
  const bucketMetadata = await getJson(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=name`);
  if (bucketMetadata.name !== bucket) throw new Error("bucket-contract");

  console.log(JSON.stringify({ status: "PASS", projectMatched: true, requiredServicesEnabled: requiredServices.size, sttBucketReadable: true }));
} catch {
  console.error(`GCP ADC preflight failed at ${stage}. Access tokens, project responses and bucket names are intentionally not printed.`);
  process.exitCode = 1;
}
