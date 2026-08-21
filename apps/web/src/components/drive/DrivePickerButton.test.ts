import {afterEach,describe,expect,it,vi} from "vitest";
import {inspectAndHashDriveFile,openVerifiedDriveStream} from "./DrivePickerButton";

afterEach(()=>vi.restoreAllMocks());

describe("Google Drive browser streaming",()=>{
  it("hashes incrementally and opens a second stream without materializing a Blob or File",async()=>{
    const blobSpy=vi.spyOn(Response.prototype,"blob");
    const fetchMock=vi.spyOn(globalThis,"fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"file-1",name:"recording.m4a",mimeType:"audio/mp4",size:"4"}),{status:200,headers:{"content-type":"application/json"}}))
      .mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("te"));controller.enqueue(new TextEncoder().encode("st"));controller.close();}}),{status:200}))
      .mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("test"));controller.close();}}),{status:200}));

    const file=await inspectAndHashDriveFile("memory-only-token","file-1");
    expect(file).toEqual({id:"file-1",name:"recording.m4a",mimeType:"audio/mp4",sizeBytes:4,sha256:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"});
    const upload=await openVerifiedDriveStream("memory-only-token",file);
    expect(upload.body).toBeInstanceOf(ReadableStream);
    expect(blobSpy).not.toHaveBeenCalled();
    for(const [,init] of fetchMock.mock.calls){const headers=new Headers(init?.headers);expect(headers.get("authorization")).toBe("Bearer memory-only-token");expect(init?.credentials).toBe("omit");}
  });

  it("rejects non-audio metadata before downloading content",async()=>{
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({id:"file-1",name:"notes.pdf",mimeType:"application/pdf",size:"4"}),{status:200}));
    await expect(inspectAndHashDriveFile("memory-only-token","file-1")).rejects.toThrow("音声ファイル");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a truncated stream before creating an upload session",async()=>{
    vi.spyOn(globalThis,"fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"file-1",name:"recording.m4a",mimeType:"audio/mp4",size:"5"}),{status:200}))
      .mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("test"));controller.close();}}),{status:200}));
    await expect(inspectAndHashDriveFile("memory-only-token","file-1")).rejects.toThrow("サイズ");
  });
});
