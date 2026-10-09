import {randomUUID} from "node:crypto";
import type {SoldgraphUsage} from "@hanamaru/contracts";
import type {HanamaruRepository} from "@hanamaru/database";
import {parseSoldgraphUsage,soldgraphAvailableAllowance} from "@hanamaru/market-price";

/** Explicit operator/scheduler entry point. No startup refresh or implicit live I/O. */
export async function refreshSoldgraphUsage(repository:HanamaruRepository,provider:{usage:()=>Promise<SoldgraphUsage>},accountId:string):Promise<void>{
  const owner=randomUUID();
  const admitted=await repository.system<{allow_extra:boolean}>("SELECT begin_soldgraph_usage($1,$2) allow_extra",[accountId,owner]);
  try{
    const response=await provider.usage();
    // Revalidate normalized adapters and fixtures before committing accounting data.
    const usage=parseSoldgraphUsage({plan:response.plan,used:response.used,limit:response.limit,remaining:response.remaining,
      extra_requests:response.extraRequests,window:response.window,shared_allowance:response.sharedAllowance,rate_limit_per_minute:response.rateLimitPerMinute});
    const available=soldgraphAvailableAllowance(usage,admitted.rows[0]!.allow_extra);
    if(available===null||available>2147483647)throw new Error("SOLDGRAPH_USAGE_INVALID");
    await repository.system("SELECT finish_soldgraph_usage($1,$2,$3::jsonb,$4)",[accountId,owner,JSON.stringify(usage),available]);
  }catch{
    await repository.system("SELECT fail_soldgraph_usage($1,$2)",[accountId,owner]);
    throw new Error("SOLDGRAPH_USAGE_RECONCILIATION_REQUIRED");
  }
}
