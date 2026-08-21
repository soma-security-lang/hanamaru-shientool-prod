import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const developmentIds = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  branchId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000010",
  membershipId: "00000000-0000-4000-8000-000000000100",
  managerUserId: "00000000-0000-4000-8000-000000000011",
  managerMembershipId: "00000000-0000-4000-8000-000000000101",
  systemAdminUserId: "00000000-0000-4000-8000-000000000012",
  systemAdminMembershipId: "00000000-0000-4000-8000-000000000102",
  visitId: "00000000-0000-4000-8000-000000001000",
  recordingId: "00000000-0000-4000-8000-000000002000",
  transcriptId: "00000000-0000-4000-8000-000000003000",
  reviewId: "00000000-0000-4000-8000-000000004000",
} as const;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export async function seedDevelopment(pool: Pool): Promise<void> {
  const d = developmentIds;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO organizations(id,organization_key,name) VALUES($1,'hanamaru','華まる') ON CONFLICT(id) DO NOTHING`, [d.organizationId]);
    await client.query(`INSERT INTO branches(id,organization_id,branch_key,name) VALUES($1,$2,'central','中央店') ON CONFLICT(id) DO NOTHING`, [d.branchId,d.organizationId]);
    await client.query(`INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name) VALUES
      ($1,$2,$3,'s***@example.invalid','佐藤 花子'),($4,$5,$6,'m***@example.invalid','鈴木 一郎') ON CONFLICT(id) DO NOTHING`,
      [d.userId,sha("dev-assessor"),sha("assessor@example.invalid"),d.managerUserId,sha("dev-manager"),sha("manager@example.invalid")]);
    await client.query(`INSERT INTO memberships(id,organization_id,user_id,branch_id) VALUES($1,$2,$3,$4),($5,$2,$6,$4) ON CONFLICT(id) DO NOTHING`,
      [d.membershipId,d.organizationId,d.userId,d.branchId,d.managerMembershipId,d.managerUserId]);
    await client.query(`INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id)
      SELECT $1,$2,id,'self',$2,$3 FROM roles WHERE role_code='assessor' ON CONFLICT DO NOTHING`,[d.organizationId,d.membershipId,d.managerMembershipId]);
    await client.query(`INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id)
      SELECT $1,$2,id,'organization',$1,$2 FROM roles WHERE role_code='manager' ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id)
      SELECT $1,$2,id,'organization',$1,$2 FROM roles WHERE role_code IN ('educator','content_approver') ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    const allowedEmail=process.env.LOCAL_ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
    if(allowedEmail)await client.query("UPDATE users SET email_hash=$2,email_masked='l***@example.invalid' WHERE id=$1",[d.managerUserId,sha(allowedEmail)]);
    const assessorEmail=process.env.LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL?.trim().toLowerCase();
    if(assessorEmail)await client.query("UPDATE users SET email_hash=$2,email_masked='a***@example.invalid' WHERE id=$1",[d.userId,sha(assessorEmail)]);
    const systemAdminEmail=process.env.LOCAL_ALLOWED_SYSTEM_ADMIN_EMAIL?.trim().toLowerCase();
    if(systemAdminEmail){
      await client.query(`INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name,status) VALUES($1,$2,$3,'a***@example.invalid','システム管理者','invited') ON CONFLICT(id) DO UPDATE SET email_hash=EXCLUDED.email_hash,email_masked=EXCLUDED.email_masked`,[d.systemAdminUserId,sha("pending-local-system-admin"),sha(systemAdminEmail)]);
      await client.query(`INSERT INTO memberships(id,organization_id,user_id,branch_id,status) VALUES($1,$2,$3,$4,'invited') ON CONFLICT(id) DO NOTHING`,[d.systemAdminMembershipId,d.organizationId,d.systemAdminUserId,d.branchId]);
      await client.query(`INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id) SELECT $1,$2,id,'organization',$1,$3 FROM roles WHERE role_code='system_admin' ON CONFLICT DO NOTHING`,[d.organizationId,d.systemAdminMembershipId,d.managerMembershipId]);
    }
    await client.query(`INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status,scheduled_at,scheduled_local_date,scheduled_local_time,scheduled_timezone,customer_label,notes_redacted)
      VALUES($1,$2,$3,$4,'HV-000001','ready',date_trunc('day',now())+interval '14 hours',((date_trunc('day',now())+interval '14 hours') AT TIME ZONE 'Asia/Tokyo')::date,((date_trunc('day',now())+interval '14 hours') AT TIME ZONE 'Asia/Tokyo')::time(0),'Asia/Tokyo','匿名顧客A','訪問前確認用の匿名案件') ON CONFLICT(id) DO NOTHING`,
      [d.visitId,d.organizationId,d.branchId,d.membershipId]);
    await client.query(`INSERT INTO form_schema_versions(organization_id,schema_key,version,json_schema,ui_schema,status,effective_from)
      VALUES($1,'visit_info',2,'{"type":"object","required":["visitDate","customerLabel","appraisalItems"],"properties":{"visitDate":{"type":"string","format":"date","title":"訪問予定日"},"visitTime":{"type":"string","pattern":"^([01]\\\\d|2[0-3]):[0-5]\\\\d$","title":"訪問予定時間"},"customerLabel":{"type":"string","maxLength":200,"title":"お客様表示名"},"appraisalItems":{"type":"string","maxLength":2000,"title":"査定品"},"visitAddress":{"type":"string","maxLength":1000,"title":"住所"},"contact":{"type":"string","maxLength":500,"title":"連絡先"},"parking":{"type":"string","maxLength":500,"title":"駐車場"},"campaign":{"type":"string","maxLength":500,"title":"キャンペーン"},"notes":{"type":"string","maxLength":4000,"title":"備考"},"assignedStaffName":{"type":"string","maxLength":200,"title":"担当"}},"additionalProperties":false}'::jsonb,'{"order":["visitDate","visitTime","customerLabel","appraisalItems","visitAddress","contact","parking","campaign","notes","assignedStaffName"]}'::jsonb,'active',now()) ON CONFLICT DO NOTHING`,[d.organizationId]);
    await client.query(`INSERT INTO prompt_versions(organization_id,purpose,version,system_instruction,output_json_schema,model_name,status,effective_from)
      VALUES($1,'pdf_extract',1,'匿名PDFから指定項目だけを抽出する','{"type":"object"}'::jsonb,'gemini-2.5-flash','approved',now()),
            ($1,'preparation',1,'確定済み抽出値と利用可能なナレッジだけを根拠に訪問前チェックを生成する','{"type":"object"}'::jsonb,'gemini-2.5-flash','approved',now()),
            ($1,'review',1,'確定済み発話だけを根拠に6領域を振り返る','{"type":"object"}'::jsonb,'gemini-2.5-flash','approved',now()) ON CONFLICT DO NOTHING`,[d.organizationId]);
    await client.query("UPDATE prompt_versions SET status='approved',approved_by_membership_id=COALESCE(approved_by_membership_id,$2),approved_at=COALESCE(approved_at,now()) WHERE organization_id=$1 AND version=1",[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO review_criteria_versions(organization_id,criteria_key,version,criteria_json,status)
      VALUES($1,'pilot',1,'{"areas":["strength","improvement","talk","compliance","next_action","revisit"]}'::jsonb,'approved') ON CONFLICT DO NOTHING`,[d.organizationId]);
    await client.query("UPDATE review_criteria_versions SET status='approved',approved_by_membership_id=COALESCE(approved_by_membership_id,$2),approved_at=COALESCE(approved_at,now()) WHERE organization_id=$1 AND version=1",[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO prompt_versions(organization_id,purpose,version,system_instruction,output_json_schema,model_name,model_parameters,status,effective_from,approved_by_membership_id,approved_at)
      VALUES($1,'review',2,'あなたは買取・リユース業の出張買取スタッフ向け振り返り支援AIです。\n確定済みの文字起こしだけを根拠に、良かった点、改善が必要な点、使えた切り返しトーク、出張買取4項目のコンプライアンス、次回への一言アドバイス、再訪問・アポ可能性を評価してください。\n観測できない事実を補完せず、判定理由にはお客様またはスタッフの実際の発言を使用してください。','{"contract":"poc_review_parity_v1","required":["good","bad","talks","compliance","advice","revisit","evidence"]}'::jsonb,'gemini-2.5-flash','{"temperature":0.3,"maxOutputTokens":2000}'::jsonb,'approved',now(),$2,now()) ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO review_criteria_versions(organization_id,criteria_key,version,criteria_json,status,approved_by_membership_id,approved_at)
      VALUES($1,'pilot',2,'{"contract":"poc_review_parity_v1","purpose":"limited_operation_training","good":{"format":"bullet_lines"},"bad":{"format":"bullet_lines"},"talks":{"maxItems":3,"fields":["scene","talk"],"categories":["貴金属","切手・テレカ・金券","ホビー","ミシン","記念硬貨","カメラ・レンズ","ブランド品","お酒","楽器","時計","贈答品","オーディオ","喫煙具・万年筆","メッキアクセサリー","価格交渉・他店比較","ダイヤ・ジュエリー","骨董品・遺品整理","出張買取｜貴金属","出張買取｜切手・テレカ・金券","出張買取｜ホビー","出張買取｜ミシン","出張買取｜記念硬貨","出張買取｜カメラ・レンズ","出張買取｜ブランド品","出張買取｜お酒","出張買取｜楽器","出張買取｜時計","出張買取｜贈答品","出張買取｜オーディオ","出張買取｜喫煙具・万年筆","出張買取｜メッキアクセサリー","出張買取｜価格交渉・他店比較","出張買取｜ダイヤ・ジュエリー","出張買取｜骨董品・遺品整理"]},"compliance":{"items":["告知","クーリングオフ","書面交付","押し買い"],"meanings":{"✅":"実施済み","❌":"未実施","⚠️":"不十分"},"definitions":{"告知":"訪問目的・業者名の告知","クーリングオフ":"クーリングオフ説明","書面交付":"買取金額等の書面交付","押し買い":"押し買い禁止・断りやすい雰囲気"}},"advice":{"sentences":{"min":2,"max":3}},"revisit":{"scores":["高","中","低"],"highSignals":["次回合意あり","決裁者不在","追加品の自己言及"],"middleSignals":["愛着保留","比較検討中","葛藤保留"],"lowConditions":["該当シグナルなし","成約完了かつ追加品言及なし","明確な拒絶・不信感"],"socialCourtesyIsNotHighSignal":true,"quoteObservedEvidence":true},"evidence":{"realTranscriptSegmentIdsOnly":true,"requiredForEveryArea":true},"usageRestriction":"training_only","humanReviewRequired":true}'::jsonb,'approved',$2,now()) ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO retention_policies(organization_id,data_type,version,retention_days,legal_hold_supported,status,effective_from,approved_by_membership_id)
      VALUES($1,'pdf',1,180,true,'active',now(),$2),($1,'audio',1,90,true,'active',now(),$2),
      ($1,'video',1,365,false,'active',now(),$2),
      ($1,'transcript',1,180,true,'active',now(),$2),($1,'review',1,180,true,'active',now(),$2),($1,'audit',1,365,false,'active',now(),$2)
      ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
      VALUES($1,'content_approval',false,$2,'承認フロー停止'),($1,'team_analytics',false,$2,'分析画面停止') ON CONFLICT DO NOTHING`,[d.organizationId,d.managerMembershipId]);
    await client.query(`INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
      VALUES($1,'pilot_content_ai',true,$2,'未承認コンテンツのAI利用を即時停止')
      ON CONFLICT(organization_id,flag_key) DO UPDATE SET enabled=true,owner_membership_id=EXCLUDED.owner_membership_id,rollback_note=EXCLUDED.rollback_note,updated_at=now()`,[d.organizationId,d.managerMembershipId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
