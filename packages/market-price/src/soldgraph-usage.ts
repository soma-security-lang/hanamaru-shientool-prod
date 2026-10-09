import type {SoldgraphUsage} from "@hanamaru/contracts";

/** Official Usage schema only; never infer calendar resets or pending-credit detail. */
export function parseSoldgraphUsage(raw:unknown):SoldgraphUsage{
  const fail=():never=>{throw new Error("SOLDGRAPH_USAGE_INVALID");};
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
  const value=raw as Record<string,unknown>;
  const integer=(input:unknown):input is number=>Number.isSafeInteger(input)&&Number(input)>=0;
  if(typeof value.plan!=="string"||! /^[a-z][a-z0-9_-]{0,39}$/u.test(value.plan)
    ||!integer(value.used)||!integer(value.extra_requests)||!integer(value.rate_limit_per_minute)||value.rate_limit_per_minute<1
    ||typeof value.shared_allowance!=="boolean"||!["one_time","rolling_30_days"].includes(value.window as string))return fail();
  if(value.limit===null||value.remaining===null){if(value.limit!==null||value.remaining!==null)return fail();}
  else if(!integer(value.limit)||!integer(value.remaining)||value.remaining!==Math.max(0,value.limit-value.used))return fail();
  return {plan:value.plan,used:value.used,limit:value.limit as number|null,remaining:value.remaining as number|null,
    extraRequests:value.extra_requests,window:value.window as SoldgraphUsage["window"],sharedAllowance:value.shared_allowance,rateLimitPerMinute:value.rate_limit_per_minute};
}

/** Null/unlimited needs explicit operator policy, not an inferred infinite budget. */
export function soldgraphAvailableAllowance(usage:SoldgraphUsage,allowExtraRequests:boolean):number|null{
  if(usage.remaining===null)return null;
  const amount=usage.remaining+(allowExtraRequests?usage.extraRequests:0);
  if(!Number.isSafeInteger(amount))throw new Error("SOLDGRAPH_USAGE_INVALID");
  return amount;
}
