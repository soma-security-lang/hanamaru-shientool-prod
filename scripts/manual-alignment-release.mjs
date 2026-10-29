import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { validateManualManifest, assertReleaseRuntime } from "./manual-alignment-policy.mjs";

// Separate, human-authorized release path. Standard GitHub gates are untouched.
const [action, path] = process.argv.slice(2);
if (!["inspect", "promote", "rollback"].includes(action) || !path) throw new Error("Usage: manual-alignment-release.mjs inspect|promote|rollback <private-manifest.json>");
const manifest = JSON.parse(readFileSync(path, "utf8"));
const target = validateManualManifest(manifest, { forRollback: action === "rollback" });
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
const account = process.env.MANUAL_RELEASE_ACCOUNT;
if (!account || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error("Explicit approved MANUAL_RELEASE_ACCOUNT required; CLI defaults are not used");
const cloud = args => run("gcloud", ["--project=monocle-503402", `--account=${account}`, ...args]);
const getService = name => JSON.parse(cloud(["run", "services", "describe", name, "--region=asia-northeast1", "--format=json"]));
const traffic = service => service.status.traffic.filter(row => row.percent > 0).map(row => ({ revision: row.revisionName, percent: row.percent }));
const equalTraffic = (a, b) => JSON.stringify([...a].sort((x,y) => x.revision.localeCompare(y.revision))) === JSON.stringify([...b].sort((x,y) => x.revision.localeCompare(y.revision)));
if (action === "rollback") {
  // Recovery must not depend on GitHub, Cloud Build or Stage availability.
  for (const row of manifest.rollbackTraffic) {
    const revision = JSON.parse(cloud(["run", "revisions", "describe", row.revision, "--region=asia-northeast1", "--format=json"]));
    if (!revision.status.conditions?.some(c => c.type === "Ready" && c.status === "True")) throw new Error("Recorded recovery revision is not ready");
  }
  cloud(["run", "services", "update-traffic", target.service, "--region=asia-northeast1",
    `--to-revisions=${manifest.rollbackTraffic.map(row => `${row.revision}=${row.percent}`).join(",")}`, "--quiet"]);
  if (!equalTraffic(traffic(getService(target.service)), manifest.rollbackTraffic)) throw new Error("Rollback read-back differs");
  console.log("ROLLBACK_TRAFFIC_CONFIRMED; verify fixed-URL authentication and data read-back");
  process.exit(0);
}
if (run("git", ["rev-parse", "HEAD"]).trim() !== manifest.sourceSha || run("git", ["status", "--porcelain"]).trim()) throw new Error("Release checkout must be the exact clean commit");
const receiptPath = realpathSync(manifest.stage.evidenceFile);
if (!receiptPath.startsWith(`${realpathSync(resolve(".artifacts"))}${sep}`)) throw new Error("Stage receipt must stay in the private artifact directory");
const receiptBytes = readFileSync(receiptPath);
if (createHash("sha256").update(receiptBytes).digest("hex") !== manifest.stage.evidenceHash) throw new Error("Stage receipt was changed");
const receipt = JSON.parse(receiptBytes.toString("utf8"));
if (receipt.environment !== "stage" || receipt.sourceSha !== manifest.sourceSha || receipt.image !== manifest.image ||
    receipt.status !== "PASS" || receipt.failed !== 0 || receipt.skipped !== 0 || receipt.passed !== manifest.stage.passed)
  throw new Error("Stage receipt does not match the executed candidate");
const origin = run("git", ["remote", "get-url", "origin"]).trim();
if (!origin.includes(target.repository)) throw new Error("Wrong source repository");
const ci = JSON.parse(run("gh", ["api", `repos/${target.repository}/actions/runs/${manifest.ciRunId}`]));
if (ci.head_sha !== manifest.sourceSha || ci.status !== "completed" || ci.conclusion !== "success") throw new Error("Exact source CI has not passed");
const build = JSON.parse(cloud(["builds", "describe", manifest.buildId, `--region=${manifest.buildRegion}`, "--format=json"]));
if (build.status !== "SUCCESS" || build.substitutions?._GIT_SHA !== manifest.sourceSha ||
  !build.results?.images?.some(image => `${image.name.split(":")[0]}@${image.digest}` === manifest.image)) throw new Error("Cloud Build image/source evidence differs");
const stage = getService(target.stage), production = getService(target.service);
assertReleaseRuntime(manifest, production);
if (!stage.status.traffic?.some(row => row.percent === 100 && row.revisionName === manifest.stage.revision)) throw new Error("Stage is not serving the accepted revision");
const stageRevision = JSON.parse(cloud(["run", "revisions", "describe", manifest.stage.revision, "--region=asia-northeast1", "--format=json"]));
if (stageRevision.spec.containers[0].image !== manifest.image || !stageRevision.status.conditions?.some(c => c.type === "Ready" && c.status === "True")) throw new Error("Stage image is not ready");
if (action === "inspect") {
  console.log(JSON.stringify({ product: manifest.product, phase: manifest.phase, sourceSha: manifest.sourceSha, image: manifest.image,
    stageRevision: manifest.stage.revision, currentTraffic: traffic(production), targetUrl: target.publicUrl, status: "VERIFIED_NOT_DEPLOYED" }, null, 2));
} else {
  if (!equalTraffic(traffic(production), manifest.rollbackTraffic)) throw new Error("Production traffic changed since approval");
  const remote = run("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0];
  if (remote !== manifest.sourceSha) throw new Error("Production release requires the exact main commit");
  const suffix = `align${manifest.sourceSha.slice(0,12)}`;
  const revision = `${target.service}-${suffix}`;
  cloud(["run", "deploy", target.service, "--region=asia-northeast1", `--image=${manifest.image}`, `--revision-suffix=${suffix}`,
    `--update-env-vars=RELEASE_SHA=${manifest.sourceSha}`, "--no-traffic", `--tag=${suffix}`, "--quiet"]);
  const candidate = JSON.parse(cloud(["run", "revisions", "describe", revision, "--region=asia-northeast1", "--format=json"]));
  if (candidate.spec.containers[0].image !== manifest.image || !candidate.status.conditions?.some(c => c.type === "Ready" && c.status === "True"))
    throw new Error("Candidate is not ready; original traffic retained");
  if (!equalTraffic(traffic(getService(target.service)), manifest.rollbackTraffic)) throw new Error("Concurrent traffic change; promotion stopped");
  cloud(["run", "services", "update-traffic", target.service, "--region=asia-northeast1", `--to-revisions=${revision}=100`, "--quiet"]);
  if (!equalTraffic(traffic(getService(target.service)), [{ revision, percent:100 }])) throw new Error("Promotion read-back differs; use recorded rollback");
  console.log(JSON.stringify({ status: "TRAFFIC_PROMOTED_NOT_ACCEPTED", revision, image: manifest.image, publicUrl: target.publicUrl }));
}
