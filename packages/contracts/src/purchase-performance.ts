export type PurchaseResultStatus="draft"|"confirmed"|"cancelled";
export interface PurchaseResultDto {id:string;branchId:string;assessorMembershipId:string;businessDate:string;purchaseAmount:string;status:PurchaseResultStatus;lockVersion:number;createdAt:string;updatedAt:string;}
export interface PurchaseRankingRow {id:string;name:string;amount:string;count:number;rank:number;}
export interface PurchasePerformanceDto {
  asOf:string;startDate:string;endDate:string;totalAmount:string;transactionCount:number;
  branches:PurchaseRankingRow[];assessors:PurchaseRankingRow[];
  branchOptions:Array<{id:string;name:string}>;
  noResultBranches:Array<{id:string;name:string}>;
  noResultAssessors:Array<{id:string;name:string}>;
  branchRankings:Array<{branchId:string;branchName:string;rows:PurchaseRankingRow[];unranked:Array<{id:string;name:string}>}>;
  series:Array<{businessDate:string;amount:string;count:number}>;
  cells:Array<{branchId:string;branchName:string;businessDate:string;amount:string;count:number}>;
  coverage:string;aggregationVersion:string;
}
export function rankPurchaseAmounts<T extends {id:string;amount:string}>(rows:T[]):Array<T&{rank:number}>{
  const sorted=[...rows].sort((a,b)=>BigInt(a.amount)===BigInt(b.amount)?a.id.localeCompare(b.id):BigInt(a.amount)>BigInt(b.amount)?-1:1);
  let rank=0,previous:string|undefined;
  return sorted.map((row,index)=>{if(previous===undefined||BigInt(previous)!==BigInt(row.amount))rank=index+1;previous=row.amount;return {...row,rank};});
}
export function purchasePeriod(date:string,period:"day"|"week"|"month"){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error("INVALID_BUSINESS_DATE");
  const start=new Date(`${date}T00:00:00Z`),end=new Date(start);
  if(period==="week"){start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6);}
  if(period==="month"){start.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1,0);}
  return {startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10)};
}
