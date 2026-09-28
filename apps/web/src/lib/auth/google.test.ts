import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>{
  const user={getIdToken:vi.fn().mockResolvedValue("firebase-id-token")};
  const auth={currentUser:user,authStateReady:vi.fn().mockResolvedValue(undefined)};
  const provider={addScope:vi.fn(),setCustomParameters:vi.fn()};
  const browserLocalPersistence={type:"LOCAL"};
  const indexedDBLocalPersistence={type:"INDEXED_DB"};
  return{
    user,auth,provider,browserLocalPersistence,indexedDBLocalPersistence,
    initializeApp:vi.fn().mockReturnValue({name:"[DEFAULT]"}),
    initializeAuth:vi.fn(()=>auth),
    getRedirectResult:vi.fn().mockResolvedValue({user}),
    signInWithCredential:vi.fn().mockResolvedValue({user}),
    signInWithRedirect:vi.fn().mockResolvedValue(undefined),
    signInWithPopup:vi.fn().mockResolvedValue({user}),
    signOut:vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("firebase/app",()=>({getApp:()=>({name:"[DEFAULT]"}),getApps:()=>[],initializeApp:mocks.initializeApp}));
vi.mock("firebase/auth",()=>{
  class GoogleAuthProvider{
    static credential(value:string){return{googleIdToken:value};}
    static credentialFromResult(){return{accessToken:"memory-only-drive-token"};}
    addScope=mocks.provider.addScope;
    setCustomParameters=mocks.provider.setCustomParameters;
  }
  return{
    GoogleAuthProvider,
    browserPopupRedirectResolver:{type:"POPUP"},
    browserLocalPersistence:mocks.browserLocalPersistence,
    indexedDBLocalPersistence:mocks.indexedDBLocalPersistence,
    getRedirectResult:mocks.getRedirectResult,
    initializeAuth:mocks.initializeAuth,
    reauthenticateWithPopup:mocks.signInWithPopup,
    signInWithCredential:mocks.signInWithCredential,
    signInWithPopup:mocks.signInWithPopup,
    signInWithRedirect:mocks.signInWithRedirect,
    signOut:mocks.signOut,
  };
});

import {beginGoogleLoginRedirect,completeGoogleLoginRedirect,driveScope,getDriveAccessToken,getIdentityToken,loginWithGoogleCredential,loginWithGooglePopup,logout} from "./google";

const originalEnv={
  apiKey:process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY,
  authDomain:process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN,
  projectId:process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID,
};

beforeEach(()=>{
  process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY="public-browser-key";
  process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN="monocle-503402.firebaseapp.com";
  process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID="monocle-503402";
  vi.clearAllMocks();
});

afterEach(async()=>{
  await logout();
  sessionStorage.removeItem("hanamaru.sso.access");
  vi.unstubAllGlobals();
  if(originalEnv.apiKey===undefined)delete process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY;else process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY=originalEnv.apiKey;
  if(originalEnv.authDomain===undefined)delete process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN;else process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN=originalEnv.authDomain;
  if(originalEnv.projectId===undefined)delete process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID;else process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID=originalEnv.projectId;
});

describe("Identity Platform browser authentication",()=>{
  it("shares authentication across tabs and defers drive.file until Drive is used",async()=>{

    await beginGoogleLoginRedirect();
    await expect(completeGoogleLoginRedirect()).resolves.toBe(true);
    await loginWithGooglePopup();
    await loginWithGoogleCredential("google-id-token");

    expect(mocks.initializeAuth).toHaveBeenCalledWith({name:"[DEFAULT]"},{persistence:[mocks.indexedDBLocalPersistence,mocks.browserLocalPersistence],popupRedirectResolver:{type:"POPUP"}});
    expect(mocks.provider.addScope).not.toHaveBeenCalled();
    expect(mocks.provider.setCustomParameters).toHaveBeenCalledWith({prompt:"select_account"});
    await expect(getIdentityToken()).resolves.toBe("firebase-id-token");
    await expect(getDriveAccessToken()).resolves.toBe("memory-only-drive-token");
    expect(mocks.provider.addScope).toHaveBeenCalledTimes(1);
    expect(mocks.provider.addScope).toHaveBeenCalledWith(driveScope);
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.getRedirectResult).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(2);
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(mocks.auth,{googleIdToken:"google-id-token"});
  });
});

describe("OIDC user and Google Drive identity binding",()=>{
  it("allows Drive only when Google resolves to the same existing membership",async()=>{
    sessionStorage.setItem("hanamaru.sso.access",JSON.stringify({token:"synthetic-sso-token",expiresAt:Date.now()+60_000}));
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(url).toContain("/me");
      expect(init?.credentials).toBe("omit");
      return new Response(JSON.stringify({id:"synthetic-membership"}),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(getDriveAccessToken()).resolves.toBe("memory-only-drive-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({authorization:"Bearer synthetic-sso-token"});
  });

  it("rejects a different Google account and discards its Drive token",async()=>{
    sessionStorage.setItem("hanamaru.sso.access",JSON.stringify({token:"synthetic-sso-token",expiresAt:Date.now()+60_000}));
    vi.stubGlobal("fetch",vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"membership-A"}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"membership-B"}),{status:200})));
    await expect(getDriveAccessToken()).rejects.toThrow("一致しません");
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
