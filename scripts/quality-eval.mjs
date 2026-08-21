import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const REVIEW_CATEGORIES=["strength","improvement","talk","compliance","next_action","revisit"];
const normalize=value=>String(value??"").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
const ratio=(numerator,denominator)=>denominator===0?1:numerator/denominator;

function editDistance(left,right){
  const a=[...left],b=[...right],row=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){
    let diagonal=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const previous=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=previous;
    }
  }
  return row[b.length];
}

function evaluatePdf(cases,minimumCases){
  let expectedCount=0,actualCount=0,exactCount=0,evidenceAligned=0,evidenceCount=0,hallucinated=0,dateDrift=0;
  for(const entry of cases){
    const keys=new Set([...Object.keys(entry.expected??{}),...Object.keys(entry.actual??{})]);
    for(const key of keys){
      const expected=entry.expected?.[key];const actualRecord=entry.actual?.[key];const actual=actualRecord?.value;
      const hasExpected=normalize(expected)!=="";const hasActual=normalize(actual)!=="";
      if(hasExpected)expectedCount++;if(hasActual)actualCount++;
      if(hasExpected&&hasActual&&normalize(expected)===normalize(actual))exactCount++;
      if(!hasExpected&&hasActual)hallucinated++;
      if(hasExpected&&hasActual){evidenceCount++;if(actualRecord?.evidence?.aligned===true)evidenceAligned++;}
      if(key==="visitDate"&&hasExpected&&hasActual&&String(expected)!==String(actual))dateDrift++;
    }
  }
  const precision=ratio(exactCount,actualCount);const recall=ratio(exactCount,expectedCount);const evidenceAlignment=ratio(evidenceAligned,evidenceCount);
  const requiredRecall=ratio(cases.filter(x=>["visitDate","customerLabel","appraisalItems"].every(key=>normalize(x.expected?.[key])!==""&&normalize(x.expected?.[key])===normalize(x.actual?.[key]?.value))).length,cases.length);
  return {caseCount:cases.length,precision,recall,requiredRecall,evidenceAlignment,hallucinated,dateDrift,pass:cases.length>=minimumCases&&precision>=.95&&recall>=.95&&requiredRecall===1&&evidenceAlignment>=.95&&hallucinated===0&&dateDrift===0};
}

function speakerPairF1(reference,predicted){
  const shared=[...new Set(Object.keys(reference))].filter(id=>id in predicted);let tp=0,fp=0,fn=0;
  for(let i=0;i<shared.length;i++)for(let j=i+1;j<shared.length;j++){
    const sameReference=reference[shared[i]]===reference[shared[j]];const samePredicted=predicted[shared[i]]===predicted[shared[j]];
    if(sameReference&&samePredicted)tp++;else if(!sameReference&&samePredicted)fp++;else if(sameReference&&!samePredicted)fn++;
  }
  const precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn);return precision+recall===0?1:2*precision*recall/(precision+recall);
}

function evaluateStt(cases,minimumCases,minimumDurationSeconds){
  let edits=0,characters=0,terms=0,matchedTerms=0,durationSeconds=0,duplicateOperations=0;const speakerScores=[];
  for(const entry of cases){
    const reference=normalize(entry.reference),hypothesis=normalize(entry.hypothesis);edits+=editDistance(reference,hypothesis);characters+=Math.max(1,[...reference].length);durationSeconds+=Number(entry.durationSeconds??0);
    for(const term of entry.importantTerms??[]){terms++;if(hypothesis.includes(normalize(term)))matchedTerms++;}
    const operationIds=(entry.operationIds??[]).filter(Boolean);duplicateOperations+=Math.max(0,new Set(operationIds).size-1);
    speakerScores.push(speakerPairF1(entry.referenceSpeakers??{},entry.predictedSpeakers??{}));
  }
  const cer=edits/Math.max(1,characters),importantTermRecall=ratio(matchedTerms,terms),speakerF1=speakerScores.reduce((sum,value)=>sum+value,0)/Math.max(1,speakerScores.length);
  return {caseCount:cases.length,durationSeconds,cer,importantTermRecall,speakerF1,duplicateOperations,pass:cases.length>=minimumCases&&durationSeconds>=minimumDurationSeconds&&cer<=.15&&importantTermRecall>=.95&&speakerF1>=.9&&duplicateOperations===0};
}

function evaluateReviews(cases,minimumCases){
  let missingCategories=0,invalidSegmentIds=0,findingsWithoutEvidence=0,misalignedEvidence=0,evidenceCount=0,complianceMisses=0,prohibitedScores=0;const humanScores=[];
  for(const entry of cases){
    const segmentById=new Map((entry.segments??[]).map(segment=>[segment.id,String(segment.text??"")]));const findings=entry.findings??[];
    for(const category of REVIEW_CATEGORIES)if(!findings.some(finding=>finding.category===category))missingCategories++;
    for(const finding of findings){
      if(["rank","ranking","personnel_score","employee_score"].some(key=>key in finding))prohibitedScores++;
      const evidence=finding.evidence??[];if(evidence.length===0)findingsWithoutEvidence++;
      for(const item of evidence){
        evidenceCount++;const segment=segmentById.get(item.segmentId);if(segment===undefined){invalidSegmentIds++;continue;}
        const excerpt=String(item.excerpt??"");const hash=createHash("sha256").update(excerpt).digest("hex");if(!excerpt||!normalize(segment).includes(normalize(excerpt))||(item.hash&&item.hash!==hash))misalignedEvidence++;
      }
    }
    complianceMisses+=Number(entry.criticalComplianceMisses??0);if(Number.isFinite(entry.humanScore))humanScores.push(Number(entry.humanScore));
  }
  const evidenceAlignment=ratio(evidenceCount-misalignedEvidence,evidenceCount);const humanAverage=humanScores.reduce((sum,value)=>sum+value,0)/Math.max(1,humanScores.length);
  return {caseCount:cases.length,missingCategories,invalidSegmentIds,findingsWithoutEvidence,evidenceAlignment,complianceMisses,prohibitedScores,humanScoreCount:humanScores.length,humanAverage,pass:cases.length>=minimumCases&&missingCategories===0&&invalidSegmentIds===0&&findingsWithoutEvidence===0&&evidenceAlignment>=.95&&complianceMisses===0&&prohibitedScores===0&&humanScores.length===cases.length&&humanAverage>=4};
}

export function evaluateQuality(manifest){
  const profile=manifest.profile==="production-volume"?"production-volume":"pilot-single";
  const thresholds=profile==="production-volume"?{pdfCases:50,sttCases:30,sttDurationSeconds:18000,reviewCases:100}:{pdfCases:1,sttCases:1,sttDurationSeconds:1,reviewCases:1};
  const pdf=evaluatePdf(manifest.pdf??[],thresholds.pdfCases),stt=evaluateStt(manifest.stt??[],thresholds.sttCases,thresholds.sttDurationSeconds),reviews=evaluateReviews(manifest.reviews??[],thresholds.reviewCases);
  return {schemaVersion:1,profile,thresholds,evaluatedAt:new Date().toISOString(),pdf,stt,reviews,pass:pdf.pass&&stt.pass&&reviews.pass};
}

async function main(){
  const input=process.argv[2],outputIndex=process.argv.indexOf("--output"),output=outputIndex>=0?process.argv[outputIndex+1]:undefined;
  if(!input)throw new Error("usage: node scripts/quality-eval.mjs <manifest.json> [--output result.json]");
  const result=evaluateQuality(JSON.parse(await readFile(input,"utf8")));const serialized=JSON.stringify(result,null,2)+"\n";
  if(output)await writeFile(output,serialized,{mode:0o600});else process.stdout.write(serialized);
  if(!result.pass)process.exitCode=1;
}

if(import.meta.url===pathToFileURL(process.argv[1]??"").href)main().catch(error=>{console.error(error instanceof Error?error.message:"quality evaluation failed");process.exitCode=2;});
