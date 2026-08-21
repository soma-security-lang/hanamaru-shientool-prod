import {expect,request,type APIRequestContext,type BrowserContext} from "@playwright/test";

interface IdentityPlatformSignIn{
  idToken:string;
  refreshToken:string;
  expiresIn:string;
  localId:string;
  email?:string;
  displayName?:string;
  photoUrl?:string;
}

export interface LiveSession{
  api:APIRequestContext;
  identityStorage:{key:string;value:string};
  me:{id:string;displayName:string;roles:string[];capabilities:string[];featureFlags:Record<string,boolean>};
}

export function liveApiBase(){return process.env.E2E_API_BASE_URL??"http://127.0.0.1:3200/api/v1";}

function identityConfig(){
  const apiKey=process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY;
  const authDomain=process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN;
  if(!apiKey||!authDomain)throw new Error("Identity Platform E2E requires NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY and NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN");
  return{apiKey,authDomain};
}

async function exchangeGoogleToken(googleIdToken:string){
  const{apiKey,authDomain}=identityConfig();
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({requestUri:`https://${authDomain}/__/auth/handler`,postBody:new URLSearchParams({id_token:googleIdToken,providerId:"google.com"}).toString(),returnIdpCredential:true,returnSecureToken:true}),
  });
  expect(response.ok,`Identity Platform Google exchange failed (${response.status})`).toBeTruthy();
  return await response.json() as IdentityPlatformSignIn;
}

function suppliedIdentityToken(prefix:"manager"|"assessor"):IdentityPlatformSignIn|null{
  const envPrefix=prefix==="manager"?"LIVE_E2E_IDENTITY_PLATFORM":"LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM";
  const idToken=process.env[`${envPrefix}_ID_TOKEN`];
  const refreshToken=process.env[`${envPrefix}_REFRESH_TOKEN`];
  const localId=process.env[`${envPrefix}_LOCAL_ID`];
  if(!idToken&&!refreshToken&&!localId)return null;
  if(!idToken||!refreshToken||!localId)throw new Error("Identity Platform E2E token inputs must be supplied together");
  return{idToken,refreshToken,localId,expiresIn:process.env.LIVE_E2E_IDENTITY_PLATFORM_EXPIRES_IN??"3600"};
}

export async function createLiveSession(googleIdToken:string,prefix:"manager"|"assessor"="manager"):Promise<LiveSession>{
  const{apiKey}=identityConfig();
  const identity=suppliedIdentityToken(prefix)??await exchangeGoogleToken(googleIdToken);
  const api=await request.newContext({baseURL:`${liveApiBase().replace(/\/$/,"")}/`,extraHTTPHeaders:{authorization:`Bearer ${identity.idToken}`}});
  const meResponse=await api.get("me");
  expect(meResponse.ok(),`Identity Platform /me failed (${meResponse.status()})`).toBeTruthy();
  const me=await meResponse.json() as LiveSession["me"];
  const expirationTime=Date.now()+Number(identity.expiresIn)*1_000;
  const authUser={uid:identity.localId,email:identity.email??null,emailVerified:true,displayName:identity.displayName??null,isAnonymous:false,photoURL:identity.photoUrl??null,phoneNumber:null,providerData:[{providerId:"google.com",uid:identity.localId,displayName:identity.displayName??null,email:identity.email??null,phoneNumber:null,photoURL:identity.photoUrl??null}],stsTokenManager:{refreshToken:identity.refreshToken,accessToken:identity.idToken,expirationTime},createdAt:String(Date.now()),lastLoginAt:String(Date.now()),apiKey,appName:"[DEFAULT]"};
  return{api,identityStorage:{key:`firebase:authUser:${apiKey}:[DEFAULT]`,value:JSON.stringify(authUser)},me};
}

export async function installLiveSession(context:BrowserContext,session:LiveSession){
  await context.addInitScript(({key,value})=>{localStorage.setItem(key,value);sessionStorage.removeItem(key);},session.identityStorage);
}
