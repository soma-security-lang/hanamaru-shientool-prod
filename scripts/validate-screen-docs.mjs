#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = resolve(process.argv[2] ?? process.env.HANAMARU_DOCS_ROOT ?? resolve(repoRoot, "../../../03_project-management/working-docs/hanamaru-shientool"));
const screensDir = resolve(docsRoot, "05-screen-design/screens");
const manifestPath = resolve(repoRoot, "docs/screen-design-contract.json");
const requiredHeadings = ["Apple Webデザイン意図", "寸法付きレイアウト", "Semantic structure", "表示・入力・操作", "Motion / accessibility", "9共通状態", "Role / capability / feature flag", "Data / adapter boundary", "テストシナリオ", "HITL受入条件", "PoC対応"];
const states = ["initial", "loading", "empty", "success", "partial", "failure", "retry", "forbidden", "deleted"];
const viewports = ["1440", "834", "390"];
const errors = [];
let results = [];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function readRoutes(source) {
  const routes = new Map();
  const matcher = /id: "(SCR-\d{3})"[\s\S]*?routes: \[([^\]]+)\]/g;
  for (const match of source.matchAll(matcher)) routes.set(match[1], [...match[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]));
  return routes;
}

const registrySource = await Promise.all(["lane-a", "lane-b", "lane-c"].map((lane) => readFile(resolve(repoRoot, `apps/web/src/features/${lane}/screens.ts`), "utf8")));
const routesByScreen = new Map(registrySource.flatMap((source) => [...readRoutes(source).entries()]));
const designMasterAvailable = await exists(screensDir);

if (designMasterAvailable) {
  const filenames = (await readdir(screensDir)).filter((file) => /^SCR-\d{3}-.+\.md$/.test(file)).sort();
  for (const filename of filenames) {
    const body = await readFile(resolve(screensDir, filename), "utf8");
    const id = body.match(/^#\s+(SCR-\d{3})/m)?.[1] ?? "UNKNOWN";
    const missingHeadings = requiredHeadings.filter((heading) => !body.includes(heading));
    const missingStates = states.filter((state) => !new RegExp(`\\b${state}\\b`, "i").test(body));
    const missingViewports = viewports.filter((width) => !body.includes(width));
    const missingRoutes = (routesByScreen.get(id) ?? []).filter((route) => !body.includes(`\`${route}\``));
    const jsonErrors = [];
    for (const [index, match] of [...body.matchAll(/```json\s*([\s\S]*?)```/g)].entries()) {
      try { JSON.parse(match[1]); } catch (error) { jsonErrors.push(`block ${index + 1}: ${error.message}`); }
    }
    const secretMatches = body.match(/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g) ?? [];
    const item = {
      id,
      filename,
      sha256: createHash("sha256").update(body).digest("hex"),
      routes: routesByScreen.get(id) ?? [],
      missing_headings: missingHeadings,
      missing_states: missingStates,
      missing_viewports: missingViewports,
      missing_routes: missingRoutes,
      json_errors: jsonErrors,
      secret_matches: secretMatches.length,
    };
    results.push(item);
    if (missingHeadings.length || missingStates.length || missingViewports.length || missingRoutes.length || jsonErrors.length || secretMatches.length) errors.push(item);
  }
  if (results.length !== 20) errors.push({ code: "SCREEN_COUNT", expected: 20, actual: results.length });
  if (!errors.length) {
    const manifest = {
      schemaVersion: 1,
      sourceMode: "external-design-master",
      requiredHeadings,
      states,
      viewports,
      screens: results.map(({ id, filename, sha256, routes }) => ({ id, filename, sha256, routes })),
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) errors.push({ code: "MANIFEST_SCHEMA", expected: 1, actual: manifest.schemaVersion });
  for (const [key, expected] of [["requiredHeadings", requiredHeadings], ["states", states], ["viewports", viewports]]) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(expected)) errors.push({ code: "MANIFEST_CONTRACT", key });
  }
  results = Array.isArray(manifest.screens) ? manifest.screens : [];
  if (results.length !== 20) errors.push({ code: "SCREEN_COUNT", expected: 20, actual: results.length });
  for (const screen of results) {
    if (!/^SCR-\d{3}$/.test(screen.id) || !/^[0-9a-f]{64}$/.test(screen.sha256 ?? "")) errors.push({ code: "MANIFEST_SCREEN", id: screen.id });
    const implementationRoutes = routesByScreen.get(screen.id) ?? [];
    if (JSON.stringify(screen.routes) !== JSON.stringify(implementationRoutes)) errors.push({ code: "ROUTE_DRIFT", id: screen.id, expected: screen.routes, actual: implementationRoutes });
  }
}

if (routesByScreen.size !== 20) errors.push({ code: "REGISTRY_COUNT", expected: 20, actual: routesByScreen.size });
const routeCount = [...routesByScreen.values()].flat().length;
if (routeCount !== 20) errors.push({ code: "ROUTE_COUNT", expected: 20, actual: routeCount });

const report = {
  generated_at: new Date().toISOString(),
  source_mode: designMasterAvailable ? "external-design-master" : "checked-in-contract-snapshot",
  screen_count: results.length,
  registry_count: routesByScreen.size,
  route_pattern_count: routeCount,
  required_heading_count: requiredHeadings.length,
  scenario_count: states.length,
  rendered_state_contracts: results.length * states.length,
  errors,
  screens: results,
};

if (designMasterAvailable) {
  const reviewRoot = resolve(docsRoot, "99-reviews");
  await writeFile(resolve(reviewRoot, "HTML-MARKDOWN-DRIFT.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = `# HTML／Markdown drift検証\n\n- Screen documents: ${results.length}/20\n- Registry definitions: ${routesByScreen.size}/20\n- Route patterns: ${routeCount}/20\n- Common state contracts: ${results.length * states.length}/180\n- Required detail headings: ${requiredHeadings.length} per screen\n- Error count: ${errors.length}\n\n${errors.length ? "## Errors\n\n```json\n" + JSON.stringify(errors, null, 2) + "\n```\n" : "20画面の詳細章、9状態、3 viewport、route、secret patternのdriftは0件。\n"}`;
  await writeFile(resolve(reviewRoot, "HTML-MARKDOWN-DRIFT.md"), markdown);
}

console.log(JSON.stringify({ source_mode: report.source_mode, screen_count: results.length, route_pattern_count: routeCount, rendered_state_contracts: results.length * states.length, error_count: errors.length }, null, 2));
if (errors.length) process.exitCode = 1;
