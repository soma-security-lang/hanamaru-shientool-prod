-- Preserve the PoC's post-transcription review rubric while retaining the GCP
-- implementation's approved-version, evidence-segment, and audit boundaries.
WITH approver AS (
  SELECT ra.organization_id,min(ra.membership_id::text)::uuid membership_id
    FROM role_assignments ra
    JOIN memberships m ON m.id=ra.membership_id AND m.organization_id=ra.organization_id AND m.status='active'
    JOIN roles r ON r.id=ra.role_id AND r.role_code='manager'
   WHERE ra.scope_type='organization' AND (ra.valid_until IS NULL OR ra.valid_until>now())
   GROUP BY ra.organization_id
), current_review AS (
  SELECT DISTINCT ON (pv.organization_id) pv.organization_id,pv.model_name
    FROM prompt_versions pv
   WHERE pv.purpose='review' AND pv.status='approved'
   ORDER BY pv.organization_id,pv.version DESC
)
INSERT INTO prompt_versions(
  organization_id,purpose,version,system_instruction,output_json_schema,
  model_name,model_parameters,status,effective_from,approved_by_membership_id,approved_at
)
SELECT a.organization_id,'review',2,
  $prompt$あなたは買取・リユース業の出張買取スタッフ向け振り返り支援AIです。
確定済みの文字起こしだけを根拠に、良かった点、改善が必要な点、使えた切り返しトーク、出張買取4項目のコンプライアンス、次回への一言アドバイス、再訪問・アポ可能性を評価してください。
観測できない事実を補完せず、判定理由にはお客様またはスタッフの実際の発言を使用してください。$prompt$,
  '{"contract":"poc_review_parity_v1","required":["good","bad","talks","compliance","advice","revisit","evidence"]}'::jsonb,
  cr.model_name,'{"temperature":0.3,"maxOutputTokens":2000}'::jsonb,
  'approved',now(),a.membership_id,now()
  FROM approver a JOIN current_review cr ON cr.organization_id=a.organization_id
ON CONFLICT(organization_id,purpose,version) DO NOTHING;

WITH approver AS (
  SELECT ra.organization_id,min(ra.membership_id::text)::uuid membership_id
    FROM role_assignments ra
    JOIN memberships m ON m.id=ra.membership_id AND m.organization_id=ra.organization_id AND m.status='active'
    JOIN roles r ON r.id=ra.role_id AND r.role_code='manager'
   WHERE ra.scope_type='organization' AND (ra.valid_until IS NULL OR ra.valid_until>now())
   GROUP BY ra.organization_id
)
INSERT INTO review_criteria_versions(
  organization_id,criteria_key,version,criteria_json,status,
  approved_by_membership_id,approved_at
)
SELECT a.organization_id,'pilot',2,
  '{
    "contract":"poc_review_parity_v1",
    "purpose":"limited_operation_training",
    "good":{"format":"bullet_lines"},
    "bad":{"format":"bullet_lines"},
    "talks":{"maxItems":3,"fields":["scene","talk"],"categories":["貴金属","切手・テレカ・金券","ホビー","ミシン","記念硬貨","カメラ・レンズ","ブランド品","お酒","楽器","時計","贈答品","オーディオ","喫煙具・万年筆","メッキアクセサリー","価格交渉・他店比較","ダイヤ・ジュエリー","骨董品・遺品整理","出張買取｜貴金属","出張買取｜切手・テレカ・金券","出張買取｜ホビー","出張買取｜ミシン","出張買取｜記念硬貨","出張買取｜カメラ・レンズ","出張買取｜ブランド品","出張買取｜お酒","出張買取｜楽器","出張買取｜時計","出張買取｜贈答品","出張買取｜オーディオ","出張買取｜喫煙具・万年筆","出張買取｜メッキアクセサリー","出張買取｜価格交渉・他店比較","出張買取｜ダイヤ・ジュエリー","出張買取｜骨董品・遺品整理"]},
    "compliance":{
      "items":["告知","クーリングオフ","書面交付","押し買い"],
      "meanings":{"✅":"実施済み","❌":"未実施","⚠️":"不十分"},
      "definitions":{"告知":"訪問目的・業者名の告知","クーリングオフ":"クーリングオフ説明","書面交付":"買取金額等の書面交付","押し買い":"押し買い禁止・断りやすい雰囲気"}
    },
    "advice":{"sentences":{"min":2,"max":3}},
    "revisit":{
      "scores":["高","中","低"],
      "highSignals":["次回合意あり","決裁者不在","追加品の自己言及"],
      "middleSignals":["愛着保留","比較検討中","葛藤保留"],
      "lowConditions":["該当シグナルなし","成約完了かつ追加品言及なし","明確な拒絶・不信感"],
      "socialCourtesyIsNotHighSignal":true,
      "quoteObservedEvidence":true
    },
    "evidence":{"realTranscriptSegmentIdsOnly":true,"requiredForEveryArea":true},
    "usageRestriction":"training_only",
    "humanReviewRequired":true
  }'::jsonb,
  'approved',a.membership_id,now()
  FROM approver a
ON CONFLICT(organization_id,criteria_key,version) DO NOTHING;
