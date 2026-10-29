import {getIdentityToken} from "@/lib/auth/google";
import {getCommonAccessToken} from "@/lib/auth/sso";
import {runtimeApiBaseUrl,runtimeLocalSession,runtimeSessionAvailable} from "@/lib/runtime-config";

export interface ApiFieldError {field:string;message:string}
export class ApiClientError extends Error { constructor(readonly status:number,readonly code:string,message:string,readonly requestId?:string,readonly fieldErrors:ApiFieldError[]=[]){super(message);} }
interface ErrorPayload { error?:{code?:string;message?:string;fieldErrors?:ApiFieldError[]};requestId?:string }
export type IdentityTokenProvider=(forceRefresh?:boolean)=>Promise<string|null>;
async function apiBearerToken(forceRefresh=false){return getCommonAccessToken()??getIdentityToken(forceRefresh);}

function notifyAuthenticationRequired(){if(typeof window!=="undefined")window.dispatchEvent(new Event("hanamaru:auth-required"));}

export class ApiClient {
  private readonly legacyResponses=new WeakSet<Response>();
  constructor(private readonly configuredBaseUrl:string|undefined=undefined,private readonly tokenProvider:IdentityTokenProvider=apiBearerToken){}
  private baseUrl(){return this.configuredBaseUrl??runtimeApiBaseUrl();}
  endpoint(path:string){return`${this.baseUrl()}${path}`;}
  resolveUrl(path:string){if(/^https?:\/\//.test(path))return path;const base=this.baseUrl();if(/^https?:\/\//.test(base))return new URL(path,base).toString();return path;}
  private isApiUrl(url:string){const origin=typeof location==="undefined"?"http://localhost":location.origin;const target=new URL(url,origin);const api=new URL(this.baseUrl(),origin);const prefix=api.pathname.replace(/\/$/,"");return target.origin===api.origin&&(target.pathname===prefix||target.pathname.startsWith(`${prefix}/`));}
  private async authorizationHeaders(headers:HeadersInit={},forceRefresh=false){const token=await this.tokenProvider(forceRefresh);if(!token){notifyAuthenticationRequired();throw new ApiClientError(401,"AUTH_REQUIRED","ログインしてください");}const result=new Headers(headers);result.set("authorization",`Bearer ${token}`);return result;}
  private async sessionState() {
    const result=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"});
    const session=await result.json() as {authenticated?:boolean;csrfToken?:string;error?:{code?:string}};
    if(!result.ok){if(result.status===401)notifyAuthenticationRequired();throw new ApiClientError(result.status,session.error?.code??"SESSION_UNAVAILABLE","認証サービスに接続できません。時間をおいて再度お試しください");}
    return session;
  }
  private async sessionHeaders(headers:HeadersInit={},verified?:Awaited<ReturnType<ApiClient["sessionState"]>>) {
    const session=verified??await this.sessionState();
    if(!session.authenticated||!session.csrfToken)throw new ApiClientError(401,"AUTH_REQUIRED","ログインしてください");
    const next=new Headers(headers);next.delete("authorization");next.set("x-csrf-token",session.csrfToken);return next;
  }
  uploadCredentialsFor(url:string):RequestCredentials{return(runtimeLocalSession()||runtimeSessionAvailable())&&this.isApiUrl(url)?"same-origin":"omit";}
  async uploadHeadersFor(url:string,headers:HeadersInit={}){
    if(!this.isApiUrl(url))return new Headers(headers);
    if(runtimeLocalSession())return this.sessionHeaders(headers);
    if(runtimeSessionAvailable()){
      const session=await this.sessionState();
      if(session.authenticated)return this.sessionHeaders(headers,session);
    }
    return this.authorizationHeaders(headers);
  }
  private async fetch(path:string,init:RequestInit,forceRefresh=false){
    const session=runtimeSessionAvailable()&&!runtimeLocalSession()?await this.sessionState():undefined;
    if(runtimeLocalSession()||session?.authenticated) {
      if(this.baseUrl()!=="/api/v1")throw new ApiClientError(503,"SESSION_CONFIGURATION","同一originのAPI設定が必要です");
      let headers=new Headers(init.headers);headers.delete("authorization");
      if(!["GET","HEAD"].includes(init.method??"GET")) {
        headers=await this.sessionHeaders(headers,session);
      }
      headers.set("accept","application/json");if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");
      return fetch(`${this.baseUrl()}${path}`,{...init,headers,credentials:"same-origin",cache:"no-store"});
    }
    const headers=await this.authorizationHeaders(init.headers,forceRefresh);headers.set("accept","application/json");if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");const response=await fetch(`${this.baseUrl()}${path}`,{...init,headers,credentials:"omit",cache:"no-store"});this.legacyResponses.add(response);return response;}
  private async execute<T>(path:string,init:RequestInit,retryAuth:boolean):Promise<T>{let response=await this.fetch(path,init,false);if(response.status===401&&(retryAuth||this.legacyResponses.has(response)))response=await this.fetch(path,init,true);if(response.status===204)return undefined as T;let payload:unknown={};try{payload=await response.json();}catch{/* empty and proxy error responses are normalized below */}if(!response.ok){const errorPayload=payload&&typeof payload==="object"?payload as ErrorPayload:{};const code=String(errorPayload.error?.code??"INTERNAL_ERROR");if(response.status===401)notifyAuthenticationRequired();throw new ApiClientError(response.status,code,String(errorPayload.error?.message??"処理を完了できませんでした"),errorPayload.requestId,errorPayload.error?.fieldErrors??[]);}return payload as T;}
  request<T>(path:string,init:RequestInit={}){return this.execute<T>(path,init,!runtimeLocalSession()&&!runtimeSessionAvailable());}
  idempotencyKey(){return crypto.randomUUID();}
  async blob(path:string):Promise<Blob>{let response=await this.fetch(path,{},false);if(response.status===401)response=await this.fetch(path,{},true);if(!response.ok){let payload:ErrorPayload={};try{payload=await response.json() as ErrorPayload;}catch{/* binary and proxy errors may not have JSON bodies */}if(response.status===401)notifyAuthenticationRequired();throw new ApiClientError(response.status,String(payload.error?.code??"INTERNAL_ERROR"),String(payload.error?.message??"ファイルを取得できませんでした"),payload.requestId,payload.error?.fieldErrors??[]);}return response.blob();}
}

export const apiClient=new ApiClient();
