import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createGoogleAiProvider,createYahooMarketPriceSourceProvider} from "../packages/platform/dist/index.js";
import {generateYahooClosedSearchUrl,parseYahooClosedSearchHtml,YAHOO_RESULT_PARSER_VERSION} from "../packages/market-price/dist/index.js";

const required=name=>{
  const value=process.env[name]?.trim();
  if(!value)throw new Error(`CONFIG_MISSING:${name}`);
  return value;
};
const classify=error=>{
  const message=error instanceof Error?error.message:String(error);
  for(const failureClass of ["YAHOO_ACCESS_BLOCKED","YAHOO_RATE_LIMITED","CAPTCHA_DETECTED","PARSER_CONTRACT_MISMATCH","SORT_CONTRACT_MISMATCH","PRICE_PARSE_FAILURE_RATE","RESPONSE_TOO_LARGE"]){
    if(message.includes(failureClass))return failureClass;
  }
  if(message.startsWith("CONFIG_MISSING:"))return message;
  if(message.includes("Could not load the default credentials"))return "ADC_UNAVAILABLE";
  if(message.includes("Vertex AI")||message.includes("market product"))return "VERTEX_AI_CONTRACT_OR_PROVIDER_ERROR";
  return "UNCLASSIFIED_PROVIDER_ERROR";
};
const artifactDirectory=resolve(dirname(fileURLToPath(import.meta.url)),"../.artifacts/local-connected-market-price",new Date().toISOString().replace(/[-:.]/gu,"").replace("Z","Z"));
const emit=async(result,exitCode=0)=>{
  await mkdir(artifactDirectory,{recursive:true});
  const evidencePath=resolve(artifactDirectory,"result.json");
  await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`,{encoding:"utf8",mode:0o600});
  console.log(JSON.stringify({...result,evidencePath}));
  process.exitCode=exitCode;
};

if(process.env.LIVE_MARKET_PRICE_DATA_CLASSIFICATION!=="anonymous-approved"){
  await emit({status:"BLOCKED",failureClass:"ANONYMOUS_APPROVAL_REQUIRED"},2);
}else{
  try{
    const projectId=required("GCP_PROJECT_ID");
    const location=required("VERTEX_LOCATION");
    const model=required("VERTEX_AI_MODEL");
    const ai=createGoogleAiProvider({projectId,location,model,inputBucket:"not-used-by-market-identification"});
    const identification=await ai.identifyMarketProduct({
      inputMode:"manual_assisted",
      productName:"Canon EOS R6 ボディ",
      category:"デジタルカメラ",
      brand:"Canon",
      modelNumber:"EOS R6",
      attributes:{構成:"ボディのみ"},
      excludeKeywords:["ジャンク","部品取り"],
      confirmedConditions:["good"],
      images:[],
    });
    const selected=identification.searchQueries.find(query=>query.breadth==="standard")??identification.searchQueries[0];
    if(!selected)throw new Error("PROVIDER_PERMANENT: market product search query is missing");
    const generated=generateYahooClosedSearchUrl({keyword:selected.keyword,conditionIds:[4],sort:"ENDED_AT_NEWEST",pageSize:100,offset:1});
    const fetched=await createYahooMarketPriceSourceProvider().fetchPage(generated.url);
    const parsed=parseYahooClosedSearchHtml(fetched.body);
    await emit({
      status:"PASS",
      vertex:{model,productCandidateCount:identification.productCandidates.length,queryCandidateCount:identification.searchQueries.length},
      yahoo:{httpStatus:fetched.status,parsedCount:parsed.items.length,sourceCount:parsed.sourceItemCount,parserVersion:parsed.parserVersion,expectedParserVersion:YAHOO_RESULT_PARSER_VERSION,newestFirst:parsed.sourceSort==="-END_TIME",pageSize:parsed.pageSize},
      evidence:{queryHash:createHash("sha256").update(selected.keyword).digest("hex"),responseHash:parsed.responseHash},
    });
  }catch(error){
    await emit({status:"BLOCKED",failureClass:classify(error)},2);
  }
}
