import ts from "typescript";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const source = file => ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
const walk = (node, visit) => { visit(node); node.forEachChild(child => walk(child, visit)); };
const location = (file, node) => ({ file: file.fileName, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : null;

export function extractApi(file) {
  const entries = [];
  walk(file, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const expression = node.expression;
    if (expression.expression.getText(file) !== "app" || !methods.has(expression.name.text)) return;
    const route = literal(node.arguments[0]);
    if (!route) throw new Error(`Nonliteral API registration at ${file.fileName}:${location(file, node).line}`);
    const handlers = new Set();
    walk(node, child => {
      if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
        const owner = child.expression.expression.getText(file);
        if (["service", "expense", "expenseCash", "purchase", "ebay"].includes(owner)) handlers.add(child.expression.getText(file));
      }
    });
    entries.push({ method: expression.name.text.toUpperCase(), path: route, handlers: [...handlers].sort(), ...location(file, node) });
  });
  return entries;
}
function screens(file) {
  const entries = [];
  walk(file, node => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const properties = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(file), p.initializer]));
    const id = literal(properties.get("id"));
    if (!id?.startsWith("SCR-")) return;
    const routes = properties.get("routes");
    if (!routes || !ts.isArrayLiteralExpression(routes)) throw new Error(`Missing routes for ${id}`);
    entries.push({ id, name: literal(properties.get("name")), routes: routes.elements.map(literal),
      featureFlag: literal(properties.get("featureFlag")), ...location(file, node) });
  });
  return entries;
}
export function inventory() {
  const screenFiles = ["lane-a", "lane-b", "lane-c", "market-price", "expense", "performance"].map(name => `apps/web/src/features/${name}/screens.ts`);
  const screenEntries = screenFiles.flatMap(file => screens(source(file))).sort((a, b) => a.id.localeCompare(b.id));
  const api = extractApi(source("apps/api/src/routes.ts"));
  if (new Set(api.map(e => `${e.method} ${e.path}`)).size !== api.length) throw new Error("Duplicate API registration");
  if (new Set(screenEntries.map(e => e.id)).size !== screenEntries.length) throw new Error("Duplicate screen id");
  const worker = source("apps/worker/src/processor.ts"), jobs = [];
  walk(worker, node => {
    if (!ts.isSwitchStatement(node) || node.expression.getText(worker) !== "job.job_type") return;
    for (const clause of node.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) jobs.push({ type: literal(clause.expression), ...location(worker, clause) });
    }
  });
  const migrationFiles = readdirSync(path.join(root, "packages/database/migrations")).filter(f => f.endsWith(".sql")).sort();
  const migrations = migrationFiles.map(name => {
    const file = `packages/database/migrations/${name}`, text = readFileSync(path.join(root, file), "utf8");
    return { file, sha256: createHash("sha256").update(text).digest("hex"),
      // Declarations only, not a live schema or an evaluation of dynamic SQL.
      createTableDeclarations: [...text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9.]*)/gi)].map(m => m[1]),
    };
  });
  return { schemaVersion: 1, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    scope: "Local source inventory; not deployment, operation, permission or live-schema verification",
    counts: { screens: screenEntries.length, apiRegistrations: api.length, apiV1Registrations: api.filter(e => e.path.startsWith("/api/v1/")).length,
      workerJobKinds: jobs.length, migrationFiles: migrations.length },
    screens: screenEntries, api, workerJobs: jobs, migrations,
    unverified: ["screen-to-API-to-DB/Job complete mapping", "live deployment digest", "effective RLS and permissions", "human business acceptance"],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inventory();
  if (process.argv.includes("--write")) {
    const target = path.join(root, ".artifacts/alignment/source-inventory.json");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify({ sourceCommit: result.sourceCommit, ...result.counts, unverified: result.unverified }, null, 2));
}
