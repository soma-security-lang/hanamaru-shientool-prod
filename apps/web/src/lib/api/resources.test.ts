import {afterEach,describe,expect,it,vi} from "vitest";
import {ApiClient,ApiClientError,apiClient} from "./client";
import {resources} from "./resources";

afterEach(()=>vi.restoreAllMocks());

describe("production resource contracts",()=>{
  it("obtains short-lived media access without materializing production recordings",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({url:"https://storage.example/signed",expiresAt:"2026-08-12T00:05:00.000Z",requiresBearer:false});
    await resources.protectedFileAccess("document","document-1");
    expect(request).toHaveBeenLastCalledWith("/documents/document-1/file-access");
    await resources.protectedFileAccess("recording","recording-1");
    expect(request).toHaveBeenLastCalledWith("/recordings/recording-1/file-access");
    const client=new ApiClient("http://localhost:3200/api/v1",vi.fn().mockResolvedValue("token"));
    expect(client.endpoint("/recordings/recording-1/file")).toBe("http://localhost:3200/api/v1/recordings/recording-1/file");
  });
  it("exposes idempotent recovery commands",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({jobId:"job-1"});
    await resources.requestExtraction("document-1");
    expect(request).toHaveBeenLastCalledWith("/documents/document-1/extractions",expect.objectContaining({method:"POST",headers:{"idempotency-key":expect.any(String)}}));
    await resources.requestTranscription("recording-1");
    expect(request).toHaveBeenLastCalledWith("/recordings/recording-1/transcriptions",expect.objectContaining({method:"POST",headers:{"idempotency-key":expect.any(String)},body:JSON.stringify({languageCode:"ja-JP"})}));
  });
  it("streams a Drive recording into the declared upload without Blob materialization",async()=>{
    const request=vi.spyOn(apiClient,"request")
      .mockResolvedValueOnce({uploadId:"upload-1",url:"http://localhost:3200/api/v1/local-uploads/upload-1",method:"PUT",headers:{"content-type":"audio/mp4"}})
      .mockResolvedValueOnce({id:"recording-1"})
      .mockResolvedValueOnce({jobId:"job-1",statusUrl:"/jobs/job-1"});
    vi.spyOn(apiClient,"uploadHeadersFor").mockResolvedValue(new Headers({"content-type":"audio/mp4","authorization":"Bearer firebase-id-token"}));
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode("test"));controller.close();}});
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(null,{status:200}));

    await resources.uploadRecordingStream("visit-1",{mimeType:"audio/mp4",sizeBytes:4,sha256:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",body},"consent-1",{capturedAt:"2026-08-12T00:00:00.000Z",durationMs:null});

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body);
    expect(request).toHaveBeenNthCalledWith(1,"/visits/visit-1/recordings/uploads",expect.objectContaining({method:"POST",body:expect.stringContaining('"sizeBytes":4')}));
    expect(request).toHaveBeenNthCalledWith(2,"/recording-uploads/upload-1/complete",expect.objectContaining({method:"POST"}));
    expect(request).toHaveBeenNthCalledWith(3,"/recordings/recording-1/transcriptions",expect.objectContaining({method:"POST"}));
  });
  it("creates, loads and confirms a generated preparation",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({jobId:"job-1"});
    await resources.requestPreparation("visit-1");
    expect(request).toHaveBeenCalledWith("/visits/visit-1/preparation",expect.objectContaining({method:"POST"}));
    request.mockResolvedValueOnce({id:"prep-1",lockVersion:2});
    await resources.confirmPreparation("visit-1",2);
    expect(request).toHaveBeenLastCalledWith("/visits/visit-1/preparation/confirm",expect.objectContaining({method:"POST",body:JSON.stringify({expectedLockVersion:2})}));
  });

  it("records transcript quality decisions with optimistic locking",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({id:"quality-1"});
    await resources.acknowledgeTranscriptQuality("transcript-1","continue",4);
    expect(request).toHaveBeenCalledWith("/transcripts/transcript-1/quality-assessment/acknowledgements",expect.objectContaining({method:"POST",headers:{"idempotency-key":expect.any(String)},body:JSON.stringify({decision:"continue",lockVersion:4})}));
  });

  it("loads authorized retention bindings and aggregate operations health",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({items:[]});
    await resources.retentionBindings("visit-1");
    expect(request).toHaveBeenLastCalledWith("/visits/visit-1/retention-bindings");
    await resources.operationsHealth();
    expect(request).toHaveBeenLastCalledWith("/admin/operations/health");
  });

  it("treats only a preparation 404 as not generated",async()=>{
    vi.spyOn(apiClient,"request").mockRejectedValue(new ApiClientError(404,"NOT_FOUND","missing"));
    await expect(resources.preparation("visit-1")).resolves.toBeNull();
  });

  it("continues a stored roleplay session and completes it idempotently",async()=>{
    const request=vi.spyOn(apiClient,"request").mockResolvedValue({sessionId:"session-1",stored:true});
    await resources.roleplayTurn("scenario-1",[{role:"staff",text:"査定の流れをご説明します"}],"session-1");
    expect(request).toHaveBeenCalledWith("/training/roleplay-turns",expect.objectContaining({headers:{"idempotency-key":expect.any(String)},body:JSON.stringify({scenarioId:"scenario-1",sessionId:"session-1",messages:[{role:"staff",text:"査定の流れをご説明します"}]})}));
    await resources.completeRoleplaySession("session-1","説明順序を復習する");
    expect(request).toHaveBeenLastCalledWith("/training/roleplay-sessions/session-1/complete",expect.objectContaining({method:"POST",body:JSON.stringify({selfNote:"説明順序を復習する"})}));
  });
});
