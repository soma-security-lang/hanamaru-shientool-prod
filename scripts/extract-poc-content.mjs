#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(process.argv[2] ?? "");

if (!process.argv[2]) throw new Error("Usage: pnpm poc:extract /absolute/path/to/app.html");

const source = await readFile(sourcePath, "utf8");
const capturedAt = new Date().toISOString();
const sourceHash = sha256(source);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function extractLiteral(name) {
  const assignment = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(source);
  if (!assignment) throw new Error(`PoC variable not found: ${name}`);
  const start = assignment.index + assignment[0].length;
  const opener = source[start];
  const closer = opener === "[" ? "]" : opener === "{" ? "}" : null;
  if (!closer) throw new Error(`Unsupported literal for ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === opener) depth += 1;
    if (character === closer && (depth -= 1) === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated literal for ${name}`);
}

function readArray(name) {
  const value = vm.runInNewContext(`(${extractLiteral(name)})`, Object.create(null), { timeout: 2_000 });
  if (!Array.isArray(value)) throw new Error(`${name} is not an array`);
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function readStaticSections(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Static section not found: ${startMarker}`);
  const range = source.slice(start, end);
  return [...range.matchAll(/<div class="mn-section">([\s\S]*?)<\/div>/g)].map((match, index) => {
    const titleMatch = match[1].match(/<h2>([\s\S]*?)<\/h2>/);
    return { index: index + 1, title: text(titleMatch?.[1] ?? `Section ${index + 1}`), body: text(match[1].replace(titleMatch?.[0] ?? "", "")) };
  });
}

const talkGroups = readArray("TALK_DATA");
const flows = readArray("FLOW_DATA");
const glossary = readArray("GLOSSARY_BASE");
const prices = readArray("PRICE_DATA");
const roleplayBasic = readArray("SCENARIOS");
const roleplayRich = readArray("_rpScenarios");
const manuals = readStaticSections("<!-- 接客マニュアル -->", "<!-- フロー詳細 -->");
const legal = readStaticSections("<!-- 法務・コンプライアンス -->", "<!-- 金券買取価格表 -->");
const records = [];

function add(type, legacyId, category, title, body, raw, options = {}) {
  const canonicalRaw = JSON.stringify(stable(raw));
  records.push({
    id: `${type}-${String(records.filter((record) => record.type === type).length + 1).padStart(5, "0")}`,
    legacy_id: legacyId,
    type,
    legacy_type: options.legacyType ?? type,
    category: text(category) || "未分類",
    title: text(title) || "要確認",
    body: text(body),
    tags: Array.isArray(options.tags) ? options.tags.map(text).filter(Boolean) : [],
    difficulty: options.difficulty ?? null,
    source: { repository: "soma-security-lang/hanamaru-shientool", file: "app.html", variable: options.variable ?? null, captured_at: capturedAt, source_sha256: sourceHash },
    original_sha256: sha256(canonicalRaw),
    source_publication_state: "visible_in_poc",
    publication_state: "draft",
    migration_state: "extracted_needs_review",
    review_reason: options.reviewReason ?? "PoC表示内容のため、業務責任者による正確性・現行性・権利確認が必要",
    legacy_payload: raw,
  });
}

for (const group of talkGroups) for (const row of group.rows ?? []) add("talk", `TALK_DATA:${group.id}:${row.no}`, group.cat, row.customer, row.talk, row, { variable: "TALK_DATA", tags: [group.cat], legacyType: "talk-row" });
for (const item of flows.filter(Boolean)) add("flow", `FLOW_DATA:${item.id}`, item.cat, item.title, [item.trigger, ...(item.steps ?? []), item.point, item.ng].filter(Boolean).join("\n"), item, { variable: "FLOW_DATA", tags: [item.cat] });
for (const [index, item] of glossary.entries()) if (item) add("glossary", `GLOSSARY_BASE:${index + 1}`, item.cat, item.term, item.desc, item, { variable: "GLOSSARY_BASE", tags: [item.cat] });
for (const item of prices.filter(Boolean)) add("price", `PRICE_DATA:${item.id}`, item.cat, item.name, `${item.issuer ?? ""} 額面:${item.face ?? ""} 買取:${item.price ?? ""} 条件:${item.cond ?? ""} 期限:${item.exp ?? ""} 備考:${item.note ?? ""}`, item, { variable: "PRICE_DATA", tags: [item.cat, item.issuer] });
for (const item of manuals) add("manual", `manual-static:${item.index}`, "接客マニュアル", item.title, item.body, item, { legacyType: "static-html", reviewReason: "PoC静的HTMLから抽出。正式な版・承認者・適用日が未取得" });
for (const item of legal) add("legal", `legal-static:${item.index}`, "法務・コンプライアンス", item.title, item.body, item, { legacyType: "static-html", reviewReason: "法的正確性・施行日・管轄を法務責任者が承認するまで公開不可" });
for (const item of roleplayBasic.filter(Boolean)) add("roleplay", `SCENARIOS:${item.id}`, item.cat, item.title, `${item.summary}\n${item.prompt}`, item, { variable: "SCENARIOS", difficulty: item.diff, tags: [item.cat], legacyType: "basic-scenario" });
for (const item of roleplayRich.filter(Boolean)) add("roleplay", `_rpScenarios:${item.id}`, item.category ?? item.type, item.title, `${item.desc ?? ""}\n${item.customerProfile ?? ""}\n${item.startMessage ?? ""}`, item, { variable: "_rpScenarios", difficulty: item.difficulty, tags: [...(item.tags ?? []), item.type, item.category], legacyType: "rich-scenario" });

const duplicateLegacyIds = [...new Set(records.map((record) => record.legacy_id).filter((id, index, all) => all.indexOf(id) !== index))];
const duplicateOriginalHashes = [...new Set(records.map((record) => record.original_sha256).filter((hash, index, all) => all.indexOf(hash) !== index))];
const missingRequired = records.filter((record) => !record.legacy_id || !record.type || !record.title || !record.original_sha256).map((record) => record.id);
const contentTypes = ["talk", "flow", "glossary", "price", "manual", "legal", "video", "roleplay"];
const byType = Object.fromEntries(contentTypes.map((type) => [type, records.filter((record) => record.type === type).length]));
const unresolvedSources = [
  { type: "video", storage: "localStorage:hanamaru_video", status: "unavailable", reason: "公開HTMLとGit管理ソースに登録済み動画データが存在しない" },
  { type: "manual", storage: "localStorage:hanamaru_manuals", status: "unavailable", reason: "管理画面から追加された端末ローカルデータはGit管理ソースから取得不能" },
  { type: "all", storage: "Google Sheets / GAS", status: "not_imported_in_ui_phase", reason: "UI HITL前の外部データ読取・API接続対象外" },
];
const summary = {
  schema_version: "1.0.0",
  generated_at: capturedAt,
  source: { path_hint: "PoC repository app.html", repository: "soma-security-lang/hanamaru-shientool", git_commit: process.env.POC_GIT_SHA ?? "unrecorded", sha256: sourceHash },
  counts: { total: records.length, by_type: byType },
  validation: { duplicate_legacy_ids: duplicateLegacyIds, duplicate_original_hashes: duplicateOriginalHashes, missing_required: missingRequired },
  unresolved_sources: unresolvedSources,
};
const register = { ...summary, records };
const report = { ...summary, rules: { target_publication_state: "draft", reason: "PoC表示済みであっても、承認者・版・現行性が確認できるまで新システムでは公開しない", personal_data: "実顧客データ、認証情報、APIキーは取り込まない" } };

await mkdir(resolve(repoRoot, "apps/web/src/mocks"), { recursive: true });
await writeFile(resolve(repoRoot, "apps/web/src/mocks/poc-content.json"), `${JSON.stringify(register, null, 2)}\n`);
await writeFile(resolve(repoRoot, "apps/web/src/mocks/poc-migration-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
