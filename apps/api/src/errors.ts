import type { ErrorCode } from "@hanamaru/contracts";
export class ApiProblem extends Error { constructor(readonly code:ErrorCode,readonly statusCode:number,message:string,readonly retryable=false,readonly fieldErrors:Array<{field:string;message:string}>=[]){super(message);} }
export const notFound=(message="対象が見つかりません")=>new ApiProblem("RESOURCE_NOT_FOUND",404,message);
export const denied=(message="この操作を行う権限がありません")=>new ApiProblem("SCOPE_DENIED",403,message);
export const invalid=(message:string,fieldErrors:Array<{field:string;message:string}>=[])=>new ApiProblem("VALIDATION_FAILED",422,message,false,fieldErrors);
