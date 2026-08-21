import {createHash} from "node:crypto";
import type {Pool,PoolClient,QueryResultRow} from "pg";

export interface ProductionBootstrapConfig {
  ids:{organization:string;branch:string;managerUser:string;managerMembership:string};
  organizationKey:string;
  organizationName:string;
  branchKey:string;
  branchName:string;
  managerEmail:string;
  managerDisplayName:string;
  vertexModel:string;
  pilotContentAiEnabled:boolean;
  retentionDays:{pdf:number;audio:number;video:number;transcript:number;review:number;audit:number};
}

export interface ProductionBootstrapResult {
  mode:"dry-run"|"apply";
  created:string[];
  existing:string[];
}

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const maskedBootstrapEmail="i***@redacted.invalid";
const desiredRoles=["manager","educator","content_approver"] as const;

const promptDefinitions=(modelName:string)=>[
  {
    purpose:"pdf_extract",
    systemInstruction:"訪問情報PDFから指定された項目だけを抽出し、根拠ページと抜粋を付ける。推測できない値は作らない。",
    outputJsonSchema:{type:"object",required:["fields"],properties:{fields:{type:"array",items:{type:"object",required:["key","value"],properties:{key:{type:"string"},value:{},page:{type:["integer","null"]},excerpt:{type:["string","null"]},confidence:{type:["number","null"]}}}}}},
    modelName,
  },
  {
    purpose:"preparation",
    systemInstruction:"確定済み抽出値と利用可能なナレッジだけを根拠に訪問前チェックを生成し、すべての根拠IDを返す。",
    outputJsonSchema:{type:"object",required:["customerFacts","anticipatedPsychology","legalChecks","suggestedTalks","anticipatedQuestions"]},
    modelName,
  },
  {
    purpose:"review",
    systemInstruction:"確定済み発話だけを根拠に、良かった点・改善点・トーク・法令・次回助言・再訪可能性の6領域を返す。",
    outputJsonSchema:{type:"object",required:["summary","findings"],properties:{summary:{type:"string"},findings:{type:"array"}}},
    modelName,
  },
] as const;

const reviewCriteria={
  purpose:"limited_operation_training",
  areas:["strength","improvement","talk","compliance","next_action","revisit"],
  usageRestriction:"training_only",
  humanReviewRequired:true,
};

const reviewParitySystemInstruction=`あなたは買取・リユース業の出張買取スタッフ向け振り返り支援AIです。
確定済みの文字起こしだけを根拠に、良かった点、改善が必要な点、使えた切り返しトーク、出張買取4項目のコンプライアンス、次回への一言アドバイス、再訪問・アポ可能性を評価してください。
観測できない事実を補完せず、判定理由にはお客様またはスタッフの実際の発言を使用してください。`;

const reviewParityCriteria={
  contract:"poc_review_parity_v1",
  purpose:"limited_operation_training",
  good:{format:"bullet_lines"},
  bad:{format:"bullet_lines"},
  talks:{maxItems:3,fields:["scene","talk"],categories:["貴金属","切手・テレカ・金券","ホビー","ミシン","記念硬貨","カメラ・レンズ","ブランド品","お酒","楽器","時計","贈答品","オーディオ","喫煙具・万年筆","メッキアクセサリー","価格交渉・他店比較","ダイヤ・ジュエリー","骨董品・遺品整理","出張買取｜貴金属","出張買取｜切手・テレカ・金券","出張買取｜ホビー","出張買取｜ミシン","出張買取｜記念硬貨","出張買取｜カメラ・レンズ","出張買取｜ブランド品","出張買取｜お酒","出張買取｜楽器","出張買取｜時計","出張買取｜贈答品","出張買取｜オーディオ","出張買取｜喫煙具・万年筆","出張買取｜メッキアクセサリー","出張買取｜価格交渉・他店比較","出張買取｜ダイヤ・ジュエリー","出張買取｜骨董品・遺品整理"]},
  compliance:{
    items:["告知","クーリングオフ","書面交付","押し買い"],
    meanings:{"✅":"実施済み","❌":"未実施","⚠️":"不十分"},
    definitions:{告知:"訪問目的・業者名の告知",クーリングオフ:"クーリングオフ説明",書面交付:"買取金額等の書面交付",押し買い:"押し買い禁止・断りやすい雰囲気"},
  },
  advice:{sentences:{min:2,max:3}},
  revisit:{
    scores:["高","中","低"],
    highSignals:["次回合意あり","決裁者不在","追加品の自己言及"],
    middleSignals:["愛着保留","比較検討中","葛藤保留"],
    lowConditions:["該当シグナルなし","成約完了かつ追加品言及なし","明確な拒絶・不信感"],
    socialCourtesyIsNotHighSignal:true,
    quoteObservedEvidence:true,
  },
  evidence:{realTranscriptSegmentIdsOnly:true,requiredForEveryArea:true},
  usageRestriction:"training_only",
  humanReviewRequired:true,
};

const featureFlags=(pilotContentAiEnabled:boolean)=>[
  {key:"content_approval",enabled:true,rollbackNote:"承認フローを無効化"},
  {key:"team_analytics",enabled:false,rollbackNote:"チーム分析を無効化"},
  {key:"pilot_content_ai",enabled:pilotContentAiEnabled,rollbackNote:"未承認コンテンツのAI利用を即時停止"},
] as const;

function required(env:NodeJS.ProcessEnv,key:string,max:number):string{
  const value=env[key]?.trim();
  const hasControl=value?[...value].some(character=>{const code=character.charCodeAt(0);return code<=31||code===127;}):false;
  if(!value||value.length>max||hasControl)throw new Error(`${key} is required and must be valid`);
  return value;
}

function keyValue(env:NodeJS.ProcessEnv,key:string):string{
  const value=required(env,key,100);
  if(!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(value))throw new Error(`${key} must use lowercase letters, numbers, hyphen, or underscore`);
  return value;
}

function integer(env:NodeJS.ProcessEnv,key:string):number{
  const raw=required(env,key,4);
  if(!/^\d+$/.test(raw))throw new Error(`${key} must be an integer between 1 and 3650`);
  const value=Number(raw);
  if(value<1||value>3650)throw new Error(`${key} must be an integer between 1 and 3650`);
  return value;
}

function uuid(env:NodeJS.ProcessEnv,key:string):string{
  const value=required(env,key,36);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error(`${key} must be a UUID`);
  return value.toLowerCase();
}

export function productionBootstrapConfig(env:NodeJS.ProcessEnv):ProductionBootstrapConfig{
  if(env.NODE_ENV!=="production")throw new Error("NODE_ENV must be production for the production bootstrap");
  const managerEmail=required(env,"BOOTSTRAP_INITIAL_MANAGER_EMAIL",320).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(managerEmail))throw new Error("BOOTSTRAP_INITIAL_MANAGER_EMAIL must be a valid email address");
  const pilot=required(env,"PILOT_CONTENT_AI_ENABLED",5);
  if(!["true","false"].includes(pilot))throw new Error("PILOT_CONTENT_AI_ENABLED must be explicitly true or false");
  return{
    ids:{
      organization:uuid(env,"BOOTSTRAP_ORGANIZATION_ID"),
      branch:uuid(env,"BOOTSTRAP_BRANCH_ID"),
      managerUser:uuid(env,"BOOTSTRAP_INITIAL_MANAGER_USER_ID"),
      managerMembership:uuid(env,"BOOTSTRAP_INITIAL_MANAGER_MEMBERSHIP_ID"),
    },
    organizationKey:keyValue(env,"BOOTSTRAP_ORGANIZATION_KEY"),
    organizationName:required(env,"BOOTSTRAP_ORGANIZATION_NAME",200),
    branchKey:keyValue(env,"BOOTSTRAP_BRANCH_KEY"),
    branchName:required(env,"BOOTSTRAP_BRANCH_NAME",200),
    managerEmail,
    managerDisplayName:required(env,"BOOTSTRAP_INITIAL_MANAGER_DISPLAY_NAME",200),
    vertexModel:required(env,"BOOTSTRAP_VERTEX_AI_MODEL",100),
    pilotContentAiEnabled:pilot==="true",
    retentionDays:{
      pdf:integer(env,"BOOTSTRAP_RETENTION_PDF_DAYS"),
      audio:integer(env,"BOOTSTRAP_RETENTION_AUDIO_DAYS"),
      video:integer(env,"BOOTSTRAP_RETENTION_VIDEO_DAYS"),
      transcript:integer(env,"BOOTSTRAP_RETENTION_TRANSCRIPT_DAYS"),
      review:integer(env,"BOOTSTRAP_RETENTION_REVIEW_DAYS"),
      audit:integer(env,"BOOTSTRAP_RETENTION_AUDIT_DAYS"),
    },
  };
}

function canonical(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function assertEqual(entity:string,field:string,actual:unknown,expected:unknown):void{
  if(canonical(actual)!==canonical(expected))throw new Error(`BOOTSTRAP_DRIFT: ${entity}.${field}`);
}

function exactlyOne<T extends QueryResultRow>(entity:string,rows:T[]):T|undefined{
  if(rows.length>1)throw new Error(`BOOTSTRAP_DRIFT: duplicate ${entity}`);
  return rows[0];
}

function record(result:ProductionBootstrapResult,entity:string,exists:boolean):void{
  (exists?result.existing:result.created).push(entity);
}

async function bootstrap(client:PoolClient,config:ProductionBootstrapConfig,apply:boolean,result:ProductionBootstrapResult):Promise<void>{
  const emailHash=sha(config.managerEmail);
  const invitedSubjectHash=sha(`bootstrap-invite:${emailHash}`);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0)),pg_advisory_xact_lock(hashtextextended($2,0))",[`bootstrap-org:${config.organizationKey}`,`bootstrap-email:${emailHash}`]);

  const organizations=await client.query<{id:string;name:string;status:string;timezone:string}>("SELECT id,name,status,timezone FROM organizations WHERE organization_key=$1 FOR UPDATE",[config.organizationKey]);
  let organization=exactlyOne("organization",organizations.rows);
  if(organization){
    assertEqual("organization","id",organization.id,config.ids.organization);
    assertEqual("organization","name",organization.name,config.organizationName);
    assertEqual("organization","status",organization.status,"active");
    assertEqual("organization","timezone",organization.timezone,"Asia/Tokyo");
  }else{
    const id=config.ids.organization;
    if(apply)organization=(await client.query<{id:string;name:string;status:string;timezone:string}>("INSERT INTO organizations(id,organization_key,name,status,timezone) VALUES($1,$2,$3,'active','Asia/Tokyo') RETURNING id,name,status,timezone",[id,config.organizationKey,config.organizationName])).rows[0];
    else organization={id,name:config.organizationName,status:"active",timezone:"Asia/Tokyo"};
  }
  if(!organization)throw new Error("BOOTSTRAP_FAILED: organization");
  record(result,"organization",Boolean(organizations.rowCount));
  await client.query("SELECT set_config('app.organization_id',$1,true)",[organization.id]);

  const branches=await client.query<{id:string;name:string;status:string}>("SELECT id,name,status FROM branches WHERE organization_id=$1 AND branch_key=$2 FOR UPDATE",[organization.id,config.branchKey]);
  let branch=exactlyOne("branch",branches.rows);
  if(branch){assertEqual("branch","name",branch.name,config.branchName);assertEqual("branch","status",branch.status,"active");}
  else{
    const id=config.ids.branch;
    if(apply)branch=(await client.query<{id:string;name:string;status:string}>("INSERT INTO branches(id,organization_id,branch_key,name,status) VALUES($1,$2,$3,$4,'active') RETURNING id,name,status",[id,organization.id,config.branchKey,config.branchName])).rows[0];
    else branch={id,name:config.branchName,status:"active"};
  }
  if(!branch)throw new Error("BOOTSTRAP_FAILED: branch");
  record(result,"branch",Boolean(branches.rowCount));

  const users=await client.query<{id:string;identity_provider:string;provider_subject_hash:string;email_masked:string;display_name:string;status:string}>("SELECT id,identity_provider,provider_subject_hash,email_masked,display_name,status FROM users WHERE email_hash=$1 ORDER BY id FOR UPDATE",[emailHash]);
  let user=exactlyOne("initial_manager_user",users.rows);
  if(user){
    assertEqual("initial_manager_user","id",user.id,config.ids.managerUser);
    assertEqual("initial_manager_user","identity_provider",user.identity_provider,"google");
    assertEqual("initial_manager_user","email_masked",user.email_masked,maskedBootstrapEmail);
    assertEqual("initial_manager_user","display_name",user.display_name,config.managerDisplayName);
    if(!["invited","active"].includes(user.status))throw new Error("BOOTSTRAP_DRIFT: initial_manager_user.status");
    if(user.status==="invited")assertEqual("initial_manager_user","provider_subject_hash",user.provider_subject_hash,invitedSubjectHash);
  }else{
    const id=config.ids.managerUser;
    if(apply)user=(await client.query<typeof users.rows[number]>("INSERT INTO users(id,identity_provider,provider_subject_hash,email_hash,email_masked,display_name,status) VALUES($1,'google',$2,$3,$4,$5,'invited') RETURNING id,identity_provider,provider_subject_hash,email_masked,display_name,status",[id,invitedSubjectHash,emailHash,maskedBootstrapEmail,config.managerDisplayName])).rows[0];
    else user={id,identity_provider:"google",provider_subject_hash:invitedSubjectHash,email_masked:maskedBootstrapEmail,display_name:config.managerDisplayName,status:"invited"};
  }
  if(!user)throw new Error("BOOTSTRAP_FAILED: initial_manager_user");
  record(result,"initial_manager_user",Boolean(users.rowCount));

  const allMemberships=await client.query<{id:string;organization_id:string;branch_id:string;status:string}>("SELECT id,organization_id,branch_id,status FROM memberships WHERE user_id=$1 ORDER BY id FOR UPDATE",[user.id]);
  if(allMemberships.rows.some(row=>row.organization_id!==organization.id))throw new Error("BOOTSTRAP_DRIFT: initial_manager_membership.organization_id");
  let membership=exactlyOne("initial_manager_membership",allMemberships.rows.filter(row=>row.organization_id===organization.id));
  if(membership){
    assertEqual("initial_manager_membership","id",membership.id,config.ids.managerMembership);
    assertEqual("initial_manager_membership","branch_id",membership.branch_id,branch.id);
    if(!["invited","active"].includes(membership.status))throw new Error("BOOTSTRAP_DRIFT: initial_manager_membership.status");
  }else{
    const id=config.ids.managerMembership;
    if(apply)membership=(await client.query<{id:string;organization_id:string;branch_id:string;status:string}>("INSERT INTO memberships(id,organization_id,user_id,branch_id,status) VALUES($1,$2,$3,$4,'invited') RETURNING id,organization_id,branch_id,status",[id,organization.id,user.id,branch.id])).rows[0];
    else membership={id,organization_id:organization.id,branch_id:branch.id,status:"invited"};
  }
  if(!membership)throw new Error("BOOTSTRAP_FAILED: initial_manager_membership");
  record(result,"initial_manager_membership",Boolean(allMemberships.rowCount));

  const roleRows=await client.query<{id:string;role_code:string}>("SELECT id,role_code FROM roles WHERE role_code=ANY($1::text[]) ORDER BY role_code",[[...desiredRoles]]);
  if(roleRows.rowCount!==desiredRoles.length)throw new Error("BOOTSTRAP_PREREQUISITE: required roles are missing; run migrations first");
  const assignments=await client.query<{role_code:string;scope_type:string;scope_id:string|null;assigned_by_membership_id:string|null;valid_until:Date|null}>("SELECT r.role_code,ra.scope_type,ra.scope_id,ra.assigned_by_membership_id,ra.valid_until FROM role_assignments ra JOIN roles r ON r.id=ra.role_id WHERE ra.organization_id=$1 AND ra.membership_id=$2 ORDER BY r.role_code",[organization.id,membership.id]);
  const activeUnexpected=assignments.rows.filter(row=>row.valid_until===null&&!desiredRoles.includes(row.role_code as typeof desiredRoles[number]));
  if(activeUnexpected.length)throw new Error("BOOTSTRAP_DRIFT: initial_manager_roles.unexpected");
  for(const roleCode of desiredRoles){
    const matches=assignments.rows.filter(row=>row.role_code===roleCode);
    const assignment=exactlyOne(`role_assignment:${roleCode}`,matches);
    if(assignment){
      assertEqual(`role_assignment:${roleCode}`,"scope_type",assignment.scope_type,"organization");
      assertEqual(`role_assignment:${roleCode}`,"scope_id",assignment.scope_id,organization.id);
      assertEqual(`role_assignment:${roleCode}`,"assigned_by_membership_id",assignment.assigned_by_membership_id,membership.id);
      assertEqual(`role_assignment:${roleCode}`,"valid_until",assignment.valid_until,null);
    }else if(apply){
      await client.query("INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id) SELECT $1,$2,id,'organization',$1,$2 FROM roles WHERE role_code=$3",[organization.id,membership.id,roleCode]);
    }
    record(result,`role:${roleCode}`,Boolean(assignment));
  }

  const retentionDefinitions=[
    {type:"pdf",days:config.retentionDays.pdf,hold:true},
    {type:"audio",days:config.retentionDays.audio,hold:true},
    {type:"video",days:config.retentionDays.video,hold:false},
    {type:"transcript",days:config.retentionDays.transcript,hold:true},
    {type:"review",days:config.retentionDays.review,hold:true},
    {type:"audit",days:config.retentionDays.audit,hold:false},
  ] as const;
  for(const definition of retentionDefinitions){
    const rows=await client.query<{retention_days:number;legal_hold_supported:boolean;status:string;approved_by_membership_id:string|null}>("SELECT retention_days,legal_hold_supported,status,approved_by_membership_id FROM retention_policies WHERE organization_id=$1 AND data_type=$2 AND version=1 FOR UPDATE",[organization.id,definition.type]);
    const policy=exactlyOne(`retention:${definition.type}`,rows.rows);
    if(policy){
      assertEqual(`retention:${definition.type}`,"retention_days",policy.retention_days,definition.days);
      assertEqual(`retention:${definition.type}`,"legal_hold_supported",policy.legal_hold_supported,definition.hold);
      assertEqual(`retention:${definition.type}`,"status",policy.status,"active");
      assertEqual(`retention:${definition.type}`,"approved_by_membership_id",policy.approved_by_membership_id,membership.id);
    }else if(apply){
      await client.query("INSERT INTO retention_policies(organization_id,data_type,version,retention_days,legal_hold_supported,status,effective_from,approved_by_membership_id) VALUES($1,$2,1,$3,$4,'active',now(),$5)",[organization.id,definition.type,definition.days,definition.hold,membership.id]);
    }
    record(result,`retention:${definition.type}`,Boolean(policy));
  }

  for(const definition of promptDefinitions(config.vertexModel)){
    const rows=await client.query<{system_instruction:string;output_json_schema:unknown;model_name:string;model_parameters:unknown;status:string;approved_by_membership_id:string|null;approved_at:Date|null}>("SELECT system_instruction,output_json_schema,model_name,model_parameters,status,approved_by_membership_id,approved_at FROM prompt_versions WHERE organization_id=$1 AND purpose=$2 AND version=1 FOR UPDATE",[organization.id,definition.purpose]);
    const prompt=exactlyOne(`prompt:${definition.purpose}`,rows.rows);
    if(prompt){
      assertEqual(`prompt:${definition.purpose}`,"system_instruction",prompt.system_instruction,definition.systemInstruction);
      assertEqual(`prompt:${definition.purpose}`,"output_json_schema",prompt.output_json_schema,definition.outputJsonSchema);
      assertEqual(`prompt:${definition.purpose}`,"model_name",prompt.model_name,definition.modelName);
      assertEqual(`prompt:${definition.purpose}`,"model_parameters",prompt.model_parameters,{});
      assertEqual(`prompt:${definition.purpose}`,"status",prompt.status,"approved");
      assertEqual(`prompt:${definition.purpose}`,"approved_by_membership_id",prompt.approved_by_membership_id,membership.id);
      if(!prompt.approved_at)throw new Error(`prompt:${definition.purpose}.approved_at drift detected`);
    }else if(apply){
      await client.query("INSERT INTO prompt_versions(organization_id,purpose,version,system_instruction,output_json_schema,model_name,model_parameters,status,effective_from,approved_by_membership_id,approved_at) VALUES($1,$2,1,$3,$4,$5,'{}','approved',now(),$6,now())",[organization.id,definition.purpose,definition.systemInstruction,definition.outputJsonSchema,definition.modelName,membership.id]);
    }
    record(result,`prompt:${definition.purpose}`,Boolean(prompt));
  }

  const criteriaRows=await client.query<{criteria_json:unknown;status:string;approved_by_membership_id:string|null;approved_at:Date|null}>("SELECT criteria_json,status,approved_by_membership_id,approved_at FROM review_criteria_versions WHERE organization_id=$1 AND criteria_key='pilot' AND version=1 FOR UPDATE",[organization.id]);
  const criteria=exactlyOne("review_criteria:pilot",criteriaRows.rows);
  if(criteria){
    assertEqual("review_criteria:pilot","criteria_json",criteria.criteria_json,reviewCriteria);
    assertEqual("review_criteria:pilot","status",criteria.status,"approved");
    assertEqual("review_criteria:pilot","approved_by_membership_id",criteria.approved_by_membership_id,membership.id);
    if(!criteria.approved_at)throw new Error("review_criteria:pilot.approved_at drift detected");
  }else if(apply){
    await client.query("INSERT INTO review_criteria_versions(organization_id,criteria_key,version,criteria_json,status,approved_by_membership_id,approved_at) VALUES($1,'pilot',1,$2,'approved',$3,now())",[organization.id,reviewCriteria,membership.id]);
  }
  record(result,"review_criteria:pilot",Boolean(criteria));

  const parityPromptRows=await client.query<{system_instruction:string;output_json_schema:unknown;model_name:string;model_parameters:unknown;status:string;approved_by_membership_id:string|null;approved_at:Date|null}>("SELECT system_instruction,output_json_schema,model_name,model_parameters,status,approved_by_membership_id,approved_at FROM prompt_versions WHERE organization_id=$1 AND purpose='review' AND version=2 FOR UPDATE",[organization.id]);
  const parityPrompt=exactlyOne("prompt:review:poc-parity",parityPromptRows.rows);
  const parityOutputSchema={contract:"poc_review_parity_v1",required:["good","bad","talks","compliance","advice","revisit","evidence"]};
  if(parityPrompt){
    assertEqual("prompt:review:poc-parity","system_instruction",parityPrompt.system_instruction,reviewParitySystemInstruction);
    assertEqual("prompt:review:poc-parity","output_json_schema",parityPrompt.output_json_schema,parityOutputSchema);
    assertEqual("prompt:review:poc-parity","model_name",parityPrompt.model_name,config.vertexModel);
    assertEqual("prompt:review:poc-parity","model_parameters",parityPrompt.model_parameters,{temperature:0.3,maxOutputTokens:2000});
    assertEqual("prompt:review:poc-parity","status",parityPrompt.status,"approved");
    assertEqual("prompt:review:poc-parity","approved_by_membership_id",parityPrompt.approved_by_membership_id,membership.id);
    if(!parityPrompt.approved_at)throw new Error("prompt:review:poc-parity.approved_at drift detected");
  }else if(apply){
    await client.query("INSERT INTO prompt_versions(organization_id,purpose,version,system_instruction,output_json_schema,model_name,model_parameters,status,effective_from,approved_by_membership_id,approved_at) VALUES($1,'review',2,$2,$3,$4,$5,'approved',now(),$6,now())",[organization.id,reviewParitySystemInstruction,parityOutputSchema,config.vertexModel,{temperature:0.3,maxOutputTokens:2000},membership.id]);
  }
  record(result,"prompt:review:poc-parity",Boolean(parityPrompt));

  const parityCriteriaRows=await client.query<{criteria_json:unknown;status:string;approved_by_membership_id:string|null;approved_at:Date|null}>("SELECT criteria_json,status,approved_by_membership_id,approved_at FROM review_criteria_versions WHERE organization_id=$1 AND criteria_key='pilot' AND version=2 FOR UPDATE",[organization.id]);
  const parityCriteria=exactlyOne("review_criteria:pilot:poc-parity",parityCriteriaRows.rows);
  if(parityCriteria){
    assertEqual("review_criteria:pilot:poc-parity","criteria_json",parityCriteria.criteria_json,reviewParityCriteria);
    assertEqual("review_criteria:pilot:poc-parity","status",parityCriteria.status,"approved");
    assertEqual("review_criteria:pilot:poc-parity","approved_by_membership_id",parityCriteria.approved_by_membership_id,membership.id);
    if(!parityCriteria.approved_at)throw new Error("review_criteria:pilot:poc-parity.approved_at drift detected");
  }else if(apply){
    await client.query("INSERT INTO review_criteria_versions(organization_id,criteria_key,version,criteria_json,status,approved_by_membership_id,approved_at) VALUES($1,'pilot',2,$2,'approved',$3,now())",[organization.id,reviewParityCriteria,membership.id]);
  }
  record(result,"review_criteria:pilot:poc-parity",Boolean(parityCriteria));

  for(const definition of featureFlags(config.pilotContentAiEnabled)){
    const rows=await client.query<{enabled:boolean;target_rule:unknown;owner_membership_id:string;expires_at:Date|null;rollback_note:string}>("SELECT enabled,target_rule,owner_membership_id,expires_at,rollback_note FROM feature_flags WHERE organization_id=$1 AND flag_key=$2 FOR UPDATE",[organization.id,definition.key]);
    const flag=exactlyOne(`feature_flag:${definition.key}`,rows.rows);
    if(flag){
      // These values are changed together by the audited feature-flag API.
      // Bootstrap supplies their defaults only on first creation and must not
      // roll back a later authorized runtime decision or its audit reason.
      assertEqual(`feature_flag:${definition.key}`,"target_rule",flag.target_rule,{});
      assertEqual(`feature_flag:${definition.key}`,"expires_at",flag.expires_at,null);
    }else if(apply){
      await client.query("INSERT INTO feature_flags(organization_id,flag_key,enabled,target_rule,owner_membership_id,rollback_note) VALUES($1,$2,$3,'{}',$4,$5)",[organization.id,definition.key,definition.enabled,membership.id,definition.rollbackNote]);
    }
    record(result,`feature_flag:${definition.key}`,Boolean(flag));
  }
}

export async function bootstrapProduction(pool:Pool,config:ProductionBootstrapConfig,apply=false):Promise<ProductionBootstrapResult>{
  const result:ProductionBootstrapResult={mode:apply?"apply":"dry-run",created:[],existing:[]};
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await bootstrap(client,config,apply,result);
    await client.query(apply?"COMMIT":"ROLLBACK");
    return result;
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
