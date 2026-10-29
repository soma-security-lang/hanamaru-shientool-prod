import {afterEach,describe,expect,it,vi} from "vitest";
import {ApiClient} from "./client";
import * as runtime from "@/lib/runtime-config";

afterEach(()=>vi.restoreAllMocks());

describe("local persistent cookie client",()=>{
  it("preserves a session-store outage and does not attempt a write or bearer login",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(true);
    const bearer=vi.fn();const client=new ApiClient("/api/v1",bearer);
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({error:{code:"SESSION_UNAVAILABLE"}},{status:503}));
    await expect(client.request("/expense-days",{method:"POST",body:"{}"})).rejects.toMatchObject({status:503,code:"SESSION_UNAVAILABLE"});
    expect(send).toHaveBeenCalledTimes(1);expect(bearer).not.toHaveBeenCalled();
  });
  it("uses CSRF for a write without bearer fallback or automatic retry",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(true);
    const bearer=vi.fn();const client=new ApiClient("/api/v1",bearer);
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(Response.json({authenticated:true,csrfToken:"synthetic"}))
      .mockResolvedValueOnce(Response.json({error:{code:"RESULT_UNKNOWN"}},{status:502}));
    await expect(client.request("/expense-days",{method:"POST",body:"{}"})).rejects.toMatchObject({status:502});
    expect(send).toHaveBeenCalledTimes(2);expect(bearer).not.toHaveBeenCalled();
    const options=send.mock.calls[1]![1]!;
    expect(new Headers(options.headers).get("x-csrf-token")).toBe("synthetic");
    expect(new Headers(options.headers).has("authorization")).toBe(false);expect(options.credentials).toBe("same-origin");
  });
  it("does not send the session or CSRF to signed external uploads",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(true);
    const client=new ApiClient("/api/v1",vi.fn());
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({authenticated:true,csrfToken:"synthetic"}));
    expect((await client.uploadHeadersFor("/api/v1/local-uploads/synthetic")).get("x-csrf-token")).toBe("synthetic");
    expect(client.uploadCredentialsFor("/api/v1/local-uploads/synthetic")).toBe("same-origin");
    expect((await client.uploadHeadersFor("https://storage.googleapis.com/synthetic")).has("x-csrf-token")).toBe(false);
    expect(client.uploadCredentialsFor("https://storage.googleapis.com/synthetic")).toBe("omit");expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Identity Platform bearer contract",()=>{
  it("adds the current Firebase ID token to every API request and omits credentials",async()=>{
    const tokenProvider=vi.fn().mockResolvedValue("firebase-id-token");
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({saved:true}),{status:200,headers:{"content-type":"application/json"}}));
    const client=new ApiClient("https://api.example.invalid/api/v1",tokenProvider);

    await expect(client.request<{saved:boolean}>("/visits",{method:"POST",body:"{}"})).resolves.toEqual({saved:true});

    const init=fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer firebase-id-token");
    expect(init?.credentials).toBe("omit");
    expect(tokenProvider).toHaveBeenCalledWith(false);
  });

  it("adds bearer authorization only to API-origin uploads and never to signed GCS URLs",async()=>{
    const tokenProvider=vi.fn().mockResolvedValue("firebase-id-token");
    const client=new ApiClient("http://localhost:3200/api/v1",tokenProvider);

    const local=await client.uploadHeadersFor("http://localhost:3200/api/v1/local-uploads/file",{"content-type":"application/pdf"});
    expect(local.get("authorization")).toBe("Bearer firebase-id-token");
    const signed=await client.uploadHeadersFor("https://storage.googleapis.com/bucket/object?signature=redacted",{"content-type":"application/pdf"});
    expect(signed.get("authorization")).toBeNull();
    expect(tokenProvider).toHaveBeenCalledTimes(1);
  });

  it("forces a Firebase ID token refresh once after a 401 and retries safely",async()=>{
    const tokenProvider=vi.fn().mockResolvedValueOnce("stale-token").mockResolvedValueOnce("fresh-token");
    const fetchMock=vi.spyOn(globalThis,"fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({error:{code:"AUTH_REQUIRED",message:"expired"}}),{status:401,headers:{"content-type":"application/json"}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({saved:true}),{status:200,headers:{"content-type":"application/json"}}));
    const client=new ApiClient("https://api.example.invalid/api/v1",tokenProvider);

    await expect(client.request<{saved:boolean}>("/visits",{method:"POST",body:"{}"})).resolves.toEqual({saved:true});

    expect(tokenProvider.mock.calls).toEqual([[false],[true]]);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer stale-token");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer fresh-token");
  });

  it("does not call the API when no Firebase user is authenticated",async()=>{
    const tokenProvider=vi.fn().mockResolvedValue(null);
    const fetchMock=vi.spyOn(globalThis,"fetch");
    const client=new ApiClient("https://api.example.invalid/api/v1",tokenProvider);

    await expect(client.request("/me")).rejects.toEqual(expect.objectContaining({status:401,code:"AUTH_REQUIRED"}));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses bearer authorization for protected binary files",async()=>{
    const tokenProvider=vi.fn().mockResolvedValue("firebase-id-token");
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("audio",{status:200}));
    const client=new ApiClient("https://api.example.invalid/api/v1",tokenProvider);

    await expect(client.blob("/recordings/recording-1/file")).resolves.toEqual(expect.objectContaining({size:5}));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer firebase-id-token");
  });

  it("preserves field-level validation errors for an accessible form recovery",async()=>{
    const tokenProvider=vi.fn().mockResolvedValue("firebase-id-token");
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({error:{code:"VALIDATION_FAILED",message:"必須項目を原本で確認してください",fieldErrors:[{field:"appraisalItems",message:"値が必要です"}]},requestId:"request-1"}),{status:422,headers:{"content-type":"application/json"}}));
    const client=new ApiClient("https://api.example.invalid/api/v1",tokenProvider);

    await expect(client.request("/extractions/extraction-1/confirm",{method:"POST",body:"{}"})).rejects.toEqual(expect.objectContaining({status:422,code:"VALIDATION_FAILED",requestId:"request-1",fieldErrors:[{field:"appraisalItems",message:"値が必要です"}]}));
  });
});

describe("production SSO and legacy Google coexistence",()=>{
  it("keeps an expired SSO session from silently falling back to Google",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(false);
    vi.spyOn(runtime,"runtimeSessionAvailable").mockReturnValue(true);
    const bearer=vi.fn().mockResolvedValue("another-google-user");
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({error:{code:"SESSION_EXPIRED"}},{status:401}));
    await expect(new ApiClient("/api/v1",bearer).request("/expense-days",{method:"POST",body:"{}"})).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});
    expect(send).toHaveBeenCalledTimes(1);expect(bearer).not.toHaveBeenCalled();
  });
  it("retains Google bearer for an explicitly unlinked, cookie-free user",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(false);
    vi.spyOn(runtime,"runtimeSessionAvailable").mockReturnValue(true);
    const bearer=vi.fn().mockResolvedValue("synthetic-google-token");
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(Response.json({authenticated:false}))
      .mockResolvedValueOnce(Response.json({saved:true}));
    await expect(new ApiClient("/api/v1",bearer).request("/expense-days",{method:"POST",body:"{}"})).resolves.toEqual({saved:true});
    expect(new Headers(send.mock.calls[1]![1]!.headers).get("authorization")).toBe("Bearer synthetic-google-token");
    expect(send.mock.calls[1]![1]!.credentials).toBe("omit");
  });
  it("uses one session check and CSRF for an authenticated SSO write",async()=>{
    vi.spyOn(runtime,"runtimeLocalSession").mockReturnValue(false);
    vi.spyOn(runtime,"runtimeSessionAvailable").mockReturnValue(true);
    const bearer=vi.fn();
    const send=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(Response.json({authenticated:true,csrfToken:"synthetic"}))
      .mockResolvedValueOnce(Response.json({saved:true}));
    await expect(new ApiClient("/api/v1",bearer).request("/expense-days",{method:"POST",body:"{}"})).resolves.toEqual({saved:true});
    expect(send).toHaveBeenCalledTimes(2);expect(bearer).not.toHaveBeenCalled();
    expect(new Headers(send.mock.calls[1]![1]!.headers).get("x-csrf-token")).toBe("synthetic");
  });
});
