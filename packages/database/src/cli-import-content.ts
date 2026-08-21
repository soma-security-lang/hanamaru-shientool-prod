import { readFile } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./repository.js";
import { developmentIds } from "./seed.js";

interface SourceItem {
  id: string; type: string; title: string; category: string; body: string; tags: string[];
  publicationState?: string; publication_state?: string; legacyPayload?: Record<string, unknown>; legacy_payload?: Record<string, unknown>; originalHash?: string; original_sha256?: string;
  migrationState?: string; migration_state?: string;
  sourceRef?: Record<string, unknown>; source?: Record<string, unknown>; legacyId?: string; legacy_id?: string;
}

const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sourcePath = resolve(process.env.POC_CONTENT_PATH ?? resolve(repositoryRoot,"apps/web/src/mocks/poc-content.json"));
const organizationId=process.env.CONTENT_IMPORT_ORGANIZATION_ID??(process.env.NODE_ENV==="production"?undefined:developmentIds.organizationId);
if(!organizationId)throw new Error("CONTENT_IMPORT_ORGANIZATION_ID is required in production");
const productionPilotSetting=process.env.PILOT_CONTENT_AI_ENABLED;
const contentOwnerMembershipId=process.env.CONTENT_IMPORT_OWNER_MEMBERSHIP_ID;
if(process.env.NODE_ENV==="production"&&!['true','false'].includes(productionPilotSetting??""))throw new Error("PILOT_CONTENT_AI_ENABLED must be explicitly true or false in production");
if(process.env.NODE_ENV==="production"&&!contentOwnerMembershipId)throw new Error("CONTENT_IMPORT_OWNER_MEMBERSHIP_ID is required in production");
const parsed = JSON.parse(await readFile(sourcePath, "utf8")) as { items?: SourceItem[]; records?: SourceItem[] } | SourceItem[];
const items = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.records ?? [];
if (!items.length) throw new Error(`No content items in ${sourcePath}`);
const pool = createPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);
  if(process.env.NODE_ENV==="production"){
    const owner=await client.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND id=$2",[organizationId,contentOwnerMembershipId]);
    if(!owner.rowCount)throw new Error("CONTENT_IMPORT_OWNER_MEMBERSHIP_ID must belong to the import organization");
    const pilotEnabled=productionPilotSetting==="true";
    await client.query(`INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
      VALUES($1,'pilot_content_ai',$2,$3,'未承認コンテンツのAI利用を即時停止')
      ON CONFLICT(organization_id,flag_key) DO UPDATE SET enabled=EXCLUDED.enabled,owner_membership_id=EXCLUDED.owner_membership_id,rollback_note=EXCLUDED.rollback_note,updated_at=now()`,[organizationId,pilotEnabled,contentOwnerMembershipId]);
  }
  for (const item of items) {
    const sourceRef=item.sourceRef??item.source??{};
    const legacyPayload=item.legacyPayload??item.legacy_payload??{};
    const originalHash=item.originalHash??item.original_sha256;
    if(!originalHash)throw new Error(`Missing source hash for ${item.id}`);
    const publicationState=item.publicationState??item.publication_state;
    const migrationState=item.migrationState??item.migration_state;
    if(publicationState!=="draft"||migrationState!=="extracted_needs_review"){
      throw new Error(`PoC import requires draft/extracted_needs_review source state for ${item.id}`);
    }
    const searchText=[item.title,item.category,item.body,...item.tags].join(" ");
    const inserted = await client.query<{ id: string }>(`INSERT INTO content_items(organization_id,content_type,stable_key,title,category,status,search_text,availability_state)
      VALUES($1,$2,$3,$4,$5,'draft',$6,'restricted')
      ON CONFLICT(organization_id,content_type,stable_key) DO NOTHING
      RETURNING id`,[organizationId,item.type,item.id,item.title,item.category,searchText]);
    const existing=inserted.rows[0]??(await client.query<{id:string}>("SELECT id FROM content_items WHERE organization_id=$1 AND content_type=$2 AND stable_key=$3",[organizationId,item.type,item.id])).rows[0];
    const contentItemId = existing?.id;
    if (!contentItemId) throw new Error(`Failed to import ${item.id}`);
    const versionInserted = await client.query<{ id: string;source_hash:string }>(`INSERT INTO content_versions(organization_id,content_item_id,version,body_json,source_type,source_reference,source_hash,review_status,published_at,migration_state)
      VALUES($1,$2,1,$3,'poc',$4,$5,'draft',NULL,'extracted_needs_review')
      ON CONFLICT(content_item_id,version) DO NOTHING
      RETURNING id,source_hash`,[
      organizationId,contentItemId,{ body:item.body,tags:item.tags,legacyPayload,sourceRef,legacyId:item.legacyId??item.legacy_id??item.id },
      `${String(sourceRef.repository ?? "poc")}:${String(sourceRef.file ?? "app.html")}`,originalHash,
    ]);
    const version=versionInserted.rows[0]??(await client.query<{id:string;source_hash:string}>("SELECT id,source_hash FROM content_versions WHERE organization_id=$1 AND content_item_id=$2 AND version=1",[organizationId,contentItemId])).rows[0];
    if(!version)throw new Error(`Failed to import version for ${item.id}`);
    if(version.source_hash!==originalHash)throw new Error(`Source hash drift requires editorial review for ${item.id}`);
    await client.query(`INSERT INTO content_version_metadata(content_version_id,organization_id,content_item_id,title,category,search_text)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(content_version_id) DO NOTHING`,[version.id,organizationId,contentItemId,item.title,item.category,searchText]);
    await client.query(`UPDATE content_items
      SET current_version_id=COALESCE(current_version_id,$1),status='draft',availability_state='pilot',title=$3,category=$4,search_text=$5
      WHERE id=$2 AND published_version_id IS NULL AND status='draft'`,[version.id,contentItemId,item.title,item.category,searchText]);
  }
  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ imported: items.length, sourcePath })}\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { client.release(); await pool.end(); }
