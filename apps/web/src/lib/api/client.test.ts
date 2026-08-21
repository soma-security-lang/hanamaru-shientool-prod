import {afterEach,describe,expect,it,vi} from "vitest";
import {ApiClient} from "./client";

afterEach(()=>vi.restoreAllMocks());

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
