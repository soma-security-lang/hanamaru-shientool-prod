import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {evaluateQuality} from "./quality-eval.mjs";

const excerpt="査定品を確認しました";const hash=createHash("sha256").update(excerpt).digest("hex");
const pdf=Array.from({length:50},()=>({expected:{visitDate:"2026-08-20",customerLabel:"匿名顧客",appraisalItems:"腕時計"},actual:{visitDate:{value:"2026-08-20",evidence:{aligned:true}},customerLabel:{value:"匿名顧客",evidence:{aligned:true}},appraisalItems:{value:"腕時計",evidence:{aligned:true}}}}));
const stt=Array.from({length:30},(_,index)=>({reference:"査定品を確認しました",hypothesis:"査定品を確認しました",durationSeconds:600,importantTerms:["査定品"],operationIds:[`operation-${index}`],referenceSpeakers:{s1:"staff",s2:"customer"},predictedSpeakers:{s1:"cluster-a",s2:"cluster-b"}}));
const findings=["strength","improvement","talk","compliance","next_action","revisit"].map(category=>({category,evidence:[{segmentId:"s1",excerpt,hash}]}));
const reviews=Array.from({length:100},()=>({segments:[{id:"s1",text:excerpt}],findings,humanScore:4,criticalComplianceMisses:0}));

test("quality gate passes only when every production threshold is met",()=>{assert.equal(evaluateQuality({profile:"production-volume",pdf,stt,reviews}).pass,true);});
test("limited operation accepts one fully verified case per journey",()=>{assert.equal(evaluateQuality({profile:"pilot-single",pdf:pdf.slice(0,1),stt:stt.slice(0,1),reviews:reviews.slice(0,1)}).pass,true);});
test("quality gate fails hallucinated PDF and missing review evidence",()=>{const broken=structuredClone({pdf,stt,reviews});broken.pdf[0].expected.notes="";broken.pdf[0].actual.notes={value:"架空値",evidence:{aligned:true}};broken.reviews[0].findings[0].evidence=[];const result=evaluateQuality(broken);assert.equal(result.pass,false);assert.equal(result.pdf.hallucinated,1);assert.ok(result.reviews.findingsWithoutEvidence>=1);});
