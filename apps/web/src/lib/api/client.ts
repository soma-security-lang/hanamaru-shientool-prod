import {getIdentityToken} from "@/lib/auth/google";

export interface ApiFieldError {field:string;message:string}
export class ApiClientError extends Error { constructor(readonly status:number,readonly code:string,message:string,readonly requestId?:string,readonly fieldErrors:ApiFieldError[]=[]){super(message);} }
interface ErrorPayload { error?:{code?:string;message?:string;fieldErrors?:ApiFieldError[]};requestId?:string }
export type IdentityTokenProvider=(forceRefresh?:boolean)=>Promise<string|null>;

function notifyAuthenticationRequired(){if(typeof window!=="undefined")window.dispatchEvent(new Event("hanamaru:auth-required"));}

export class ApiClient {
  constructor(private readonly baseUrl=process.env.NEXT_PUBLIC_API_BASE_URL??"/api/v1",private readonly tokenProvider:IdentityTokenProvider=getIdentityToken){}
  endpoint(path:string){return`${this.baseUrl}${path}`;}
  resolveUrl(path:string){if(/^https?:\/\//.test(path))return path;if(/^https?:\/\//.test(this.baseUrl))return new URL(path,this.baseUrl).toString();return path;}
  private isApiUrl(url:string){const origin=typeof location==="undefined"?"http://localhost":location.origin;const target=new URL(url,origin);const api=new URL(this.baseUrl,origin);const prefix=api.pathname.replace(/\/$/,"");return target.origin===api.origin&&(target.pathname===prefix||target.pathname.startsWith(`${prefix}/`));}
  private async authorizationHeaders(headers:HeadersInit={},forceRefresh=false){const token=await this.tokenProvider(forceRefresh);if(!token){notifyAuthenticationRequired();throw new ApiClientError(401,"AUTH_REQUIRED","Googleへログインしてください");}const result=new Headers(headers);result.set("authorization",`Bearer ${token}`);return result;}
  async uploadHeadersFor(url:string,headers:HeadersInit={}){return this.isApiUrl(url)?this.authorizationHeaders(headers):new Headers(headers);}
  private async fetch(path:string,init:RequestInit,forceRefresh=false){const headers=await this.authorizationHeaders(init.headers,forceRefresh);headers.set("accept","application/json");if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");return fetch(`${this.baseUrl}${path}`,{...init,headers,credentials:"omit",cache:"no-store"});}
  private async execute<T>(path:string,init:RequestInit,retryAuth:boolean):Promise<T>{let response=await this.fetch(path,init,false);if(response.status===401&&retryAuth)response=await this.fetch(path,init,true);if(response.status===204)return undefined as T;let payload:unknown={};try{payload=await response.json();}catch{/* empty and proxy error responses are normalized below */}if(!response.ok){const errorPayload=payload&&typeof payload==="object"?payload as ErrorPayload:{};const code=String(errorPayload.error?.code??"INTERNAL_ERROR");if(response.status===401)notifyAuthenticationRequired();throw new ApiClientError(response.status,code,String(errorPayload.error?.message??"処理を完了できませんでした"),errorPayload.requestId,errorPayload.error?.fieldErrors??[]);}return payload as T;}
  request<T>(path:string,init:RequestInit={}){return this.execute<T>(path,init,true);}
  idempotencyKey(){return crypto.randomUUID();}
  async blob(path:string):Promise<Blob>{let response=await this.fetch(path,{},false);if(response.status===401)response=await this.fetch(path,{},true);if(!response.ok){let payload:ErrorPayload={};try{payload=await response.json() as ErrorPayload;}catch{/* binary and proxy errors may not have JSON bodies */}if(response.status===401)notifyAuthenticationRequired();throw new ApiClientError(response.status,String(payload.error?.code??"INTERNAL_ERROR"),String(payload.error?.message??"ファイルを取得できませんでした"),payload.requestId,payload.error?.fieldErrors??[]);}return response.blob();}
}

export const apiClient=new ApiClient();
