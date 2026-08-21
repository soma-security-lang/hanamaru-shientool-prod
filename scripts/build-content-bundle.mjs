import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "apps/web/src/mocks/poc-content.json");
const outputDir = resolve(root, "apps/web/src/generated/poc-content");
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const types = ["talk", "flow", "glossary", "price", "manual", "legal", "video", "roleplay"];

await mkdir(outputDir, { recursive: true });

const index = source.records.map((record) => ({
  id: record.id,
  legacyId: record.legacy_id,
  type: record.type,
  category: record.category,
  title: record.title,
  tags: record.tags ?? [],
  difficulty: record.difficulty,
  publicationState: record.publication_state,
  searchText: [record.title, record.category, ...(record.tags ?? []), record.body]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP"),
}));

const catalog = {
  schemaVersion: source.schema_version,
  generatedAt: source.generated_at,
  source: source.source,
  counts: source.counts.by_type,
  total: source.counts.total,
  unresolvedSources: source.unresolved_sources,
  duplicateOriginalHashes: source.validation.duplicate_original_hashes,
};

await writeFile(resolve(outputDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(resolve(outputDir, "index.json"), `${JSON.stringify(index)}\n`);

for (const type of types) {
  const records = source.records
    .filter((record) => record.type === type)
    .map((record) => ({
      id: record.id,
      legacyId: record.legacy_id,
      type: record.type,
      category: record.category,
      title: record.title,
      tags: record.tags ?? [],
      difficulty: record.difficulty,
      publicationState: record.publication_state,
      body: record.body,
      legacyPayload: record.legacy_payload,
      sourceRef: record.source,
      originalHash: record.original_sha256,
      migrationState: record.migration_state,
      reviewReason: record.review_reason,
    }));
  await writeFile(resolve(outputDir, `${type}.json`), `${JSON.stringify(records)}\n`);
}

console.log(`Built ${index.length} content records into ${outputDir}`);
