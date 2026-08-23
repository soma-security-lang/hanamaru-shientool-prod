import {reviewDimensions,type AiProvider,type ReviewDimension} from "./types.js";

type Json=Record<string,unknown>;
const complianceLabels=["告知","クーリングオフ","書面交付","押し買い"] as const;
const structuredComplianceChecks=[
  {key:"notification",label:"告知"},
  {key:"coolingOff",label:"クーリングオフ"},
  {key:"documentDelivery",label:"書面交付"},
  {key:"pressureSelling",label:"押し買い"},
] as const;
const complianceStatusIcons={compliant:"✅",noncompliant:"❌",unclear:"⚠️"} as const;
const revisitPatterns=["次回合意あり","決裁者不在","追加品の自己言及","愛着保留","比較検討中","葛藤保留"] as const;
const object=(value:unknown):Json=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("PROVIDER_PERMANENT: model output is not an object");return value as Json;};
const requiredText=(value:unknown,name:string,max:number)=>{if(typeof value!=="string"||!value.trim()||value.length>max)throw new Error(`PROVIDER_PERMANENT: invalid ${name}`);return value.trim();};
const evidenceIds=(value:unknown,name:string)=>{const ids=Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==="string"&&Boolean(id.trim())).map(id=>id.trim()))].slice(0,20):[];if(!ids.length)throw new Error(`PROVIDER_PERMANENT: missing review evidence ${name}`);return ids;};

function normalizeStructuredCompliance(value:unknown){
  if(value==null)throw new Error("PROVIDER_PERMANENT: missing review compliance checks");
  const checks=object(value);
  const normalized=structuredComplianceChecks.map(({key,label})=>{
    if(checks[key]==null)throw new Error(`PROVIDER_PERMANENT: missing review compliance check ${key}`);
    const check=object(checks[key]);
    const status=requiredText(check.status,`complianceChecks.${key}.status`,30) as keyof typeof complianceStatusIcons;
    const icon=complianceStatusIcons[status];
    if(!icon)throw new Error(`PROVIDER_PERMANENT: invalid compliance status ${key}`);
    const detail=requiredText(check.detail,`complianceChecks.${key}.detail`,1000);
    return{label,line:`${label}: ${icon} ${detail}`,evidenceSegmentIds:evidenceIds(check.evidenceSegmentIds,`complianceChecks.${key}`)};
  });
  return{
    description:normalized.map(check=>check.line).join("\n"),
    evidenceSegmentIds:[...new Set(normalized.flatMap(check=>check.evidenceSegmentIds))],
  };
}

export function parseModelJson(text:string):Json{const clean=text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");try{return object(JSON.parse(clean));}catch(error){if(error instanceof Error&&error.message.startsWith("PROVIDER_"))throw error;throw new Error("PROVIDER_PERMANENT: model returned invalid JSON");}}

export function normalizeReviewOutput(value:unknown,model:string,dimensions:readonly ReviewDimension[]=reviewDimensions):Awaited<ReturnType<AiProvider["review"]>>{
  const root=object(value);
  if("good" in root||"bad" in root||"compliance" in root||"revisit" in root){
    const evidence=object(root.evidence);const compliance=object(root.compliance);const complianceEvidence=object(root.complianceEvidence);const revisit=object(root.revisit);
    const talks=(Array.isArray(root.talks)?root.talks:[]).slice(0,3).map((item,index)=>{const row=object(item);return{scene:requiredText(row.scene,`talks.${index}.scene`,500),talk:requiredText(row.talk,`talks.${index}.talk`,2000),evidenceSegmentIds:evidenceIds(row.evidenceSegmentIds,`talks.${index}`)};});
    if(!talks.length)throw new Error("PROVIDER_PERMANENT: missing review talks");
    const complianceLines=complianceLabels.map(label=>{const result=requiredText(compliance[label],`compliance.${label}`,1000);if(!["✅","❌","⚠️"].some(status=>result.startsWith(status)))throw new Error(`PROVIDER_PERMANENT: invalid compliance status ${label}`);return`${label}: ${result}`;});
    const complianceIds=[...new Set(complianceLabels.flatMap(label=>evidenceIds(complianceEvidence[label],`compliance.${label}`)))];
    const score=requiredText(revisit.score,"revisit.score",10);if(!["高","中","低"].includes(score))throw new Error("PROVIDER_PERMANENT: invalid revisit score");
    const patterns=Array.isArray(revisit.patterns)?[...new Set(revisit.patterns.filter((pattern):pattern is string=>typeof pattern==="string"&&revisitPatterns.includes(pattern as typeof revisitPatterns[number])))]:[];
    const revisitEvidence=evidenceIds(revisit.evidenceSegmentIds,"revisit");
    const good=requiredText(root.good,"good",5000);const bad=requiredText(root.bad,"bad",5000);const advice=requiredText(root.advice,"advice",2000);const reason=requiredText(revisit.reason,"revisit.reason",2000);
    const findings:Awaited<ReturnType<AiProvider["review"]>>["findings"]=[
      {category:"strength",title:"良かった点",description:good,recommendedAction:null,evidenceSegmentIds:evidenceIds(evidence.good,"strength")},
      {category:"improvement",title:"改善が必要な点",description:bad,recommendedAction:null,evidenceSegmentIds:evidenceIds(evidence.bad,"improvement")},
      {category:"talk",title:"この場面で使えた切り返しトーク",description:talks.map(item=>`【${item.scene}】${item.talk}`).join("\n"),recommendedAction:null,evidenceSegmentIds:[...new Set(talks.flatMap(item=>item.evidenceSegmentIds))]},
      {category:"compliance",title:"コンプライアンスチェック（出張買取）",description:complianceLines.join("\n"),recommendedAction:null,evidenceSegmentIds:complianceIds},
      {category:"next_action",title:"次回への一言アドバイス",description:advice,recommendedAction:advice,evidenceSegmentIds:evidenceIds(evidence.advice,"next_action")},
      {category:"revisit",title:`再訪問・アポ可能性：${score}`,description:`判定: ${score}\n理由: ${reason}\n該当パターン: ${patterns.length?patterns.join("、"):"なし"}`,recommendedAction:null,evidenceSegmentIds:revisitEvidence},
    ];
    return{model,summary:requiredText(root.summary??`${good}\n${bad}`,"summary",5000),findings:findings.filter(finding=>dimensions.includes(finding.category as ReviewDimension))};
  }
  const raw=Array.isArray(root.findings)?root.findings:[];const byCategory=new Map(raw.map(item=>{const row=object(item);return[String(row.category),row] as const;}));
  const structuredCompliance=dimensions.includes("compliance")?normalizeStructuredCompliance(root.complianceChecks):null;
  const findings=dimensions.map(category=>{const row=byCategory.get(category);if(!row)throw new Error(`PROVIDER_PERMANENT: missing review category ${category}`);return{category,title:requiredText(row.title,`${category}.title`,300),description:category==="compliance"?structuredCompliance!.description:requiredText(row.description,`${category}.description`,5000),recommendedAction:row.recommendedAction==null?null:requiredText(row.recommendedAction,`${category}.recommendedAction`,2000),evidenceSegmentIds:category==="compliance"?structuredCompliance!.evidenceSegmentIds:evidenceIds(row.evidenceSegmentIds,category)};});
  return{model,summary:requiredText(root.summary,"summary",5000),findings};
}

export function normalizeRoleplayOutput(value:unknown,model:string):Awaited<ReturnType<AiProvider["roleplay"]>>{
  const root=object(value);if("score" in root||"rank" in root||"rating" in root)throw new Error("PROVIDER_PERMANENT: ranking fields are not allowed");const feedback=(Array.isArray(root.feedback)?root.feedback:[]).slice(0,8).map((item,index)=>{const row=object(item);return{category:requiredText(row.category,`feedback.${index}.category`,100),message:requiredText(row.message,`feedback.${index}.message`,1000)};});if(!feedback.length)throw new Error("PROVIDER_PERMANENT: missing roleplay feedback");return{model,customerReply:requiredText(root.customerReply,"customerReply",2000),feedback};
}
