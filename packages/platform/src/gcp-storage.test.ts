import {createHash} from "node:crypto";
import type {Bucket,Storage} from "@google-cloud/storage";
import {describe,expect,it,vi} from "vitest";
import {createGcpStorageProvider,pendingUploadObjectName} from "./gcp.js";

describe("GCS write-once storage",()=>{
  it("does not compare a byte range with the full-object checksum",async()=>{
    const createReadStream=vi.fn().mockReturnValue({});
    const bucket={file:vi.fn(()=>({createReadStream}))};
    const storage={bucket:vi.fn(()=>bucket)} as unknown as Storage;
    const provider=createGcpStorageProvider({projectId:"project",bucket:"private"},storage);
    await provider.openRead("objects/pdf","1700000000000001",{start:0,end:4});
    expect(createReadStream).toHaveBeenCalledWith({validation:false,start:0,end:4});
    await provider.openRead("objects/pdf","1700000000000001");
    expect(createReadStream).toHaveBeenLastCalledWith({validation:true});
  });

  it("signs uploads with a create-only generation precondition",async()=>{
    const getSignedUrl=vi.fn().mockResolvedValue(["https://storage.example.invalid/signed"]);
    const save=vi.fn().mockResolvedValue(undefined);
    const getMetadata=vi.fn().mockResolvedValue([{generation:"1700000000000001",size:"4",contentType:"text/plain"}]);
    const bucket={file:vi.fn(()=>({getSignedUrl,save,getMetadata}))};
    const storage={bucket:vi.fn(()=>bucket)} as unknown as Storage;
    const provider=createGcpStorageProvider({projectId:"project",bucket:"private"},storage);
    const body=Buffer.from("safe");const sha256=createHash("sha256").update(body).digest("hex");
    const declaration={organizationId:"org",objectName:"objects/write-once",mimeType:"text/plain",sizeBytes:body.byteLength,sha256,expiresAt:new Date("2030-01-01T00:00:00Z")};
    const signed=await provider.createUpload(declaration);
    expect(bucket.file).toHaveBeenCalledWith(pendingUploadObjectName(declaration.objectName));
    expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({extensionHeaders:{"x-goog-if-generation-match":"0","x-goog-meta-sha256":sha256}}));
    expect(signed.headers).toMatchObject({"x-goog-if-generation-match":"0","x-goog-meta-sha256":sha256});
    await expect(provider.put({...declaration,body})).resolves.toMatchObject({generation:"1700000000000001"});
    expect(save).toHaveBeenCalledWith(body,expect.objectContaining({preconditionOpts:{ifGenerationMatch:0}}));
  });

  it("deletes every exact-name generation and confirms none remain",async()=>{
    const generations=new Set(["1700000000000001","1700000000000002","1700000000000003"]);const deleted:string[]=[];
    const bucket={
      getFiles:vi.fn(async()=>[[...generations].map(generation=>({name:"objects/private",metadata:{generation}})).concat([{name:"objects/private-suffix",metadata:{generation:"9"}}])]),
      file:vi.fn((_name:string,options:{generation:string})=>({delete:vi.fn(async(input:{ifGenerationMatch:string})=>{expect(input.ifGenerationMatch).toBe(options.generation);deleted.push(options.generation);generations.delete(options.generation);})})),
    } as unknown as Bucket;
    const storage={bucket:vi.fn(()=>bucket)} as unknown as Storage;
    const provider=createGcpStorageProvider({projectId:"project",bucket:"private"},storage);
    await provider.delete("objects/private","1700000000000003");
    expect(deleted.sort()).toEqual(["1700000000000001","1700000000000002","1700000000000003"]);
    expect(bucket.getFiles).toHaveBeenCalledTimes(2);
    await expect(provider.delete("objects/private","not-a-generation")).rejects.toThrow("tracked GCS generation is invalid");
  });

  it("deletes canonical and quarantined generations for an expired incomplete upload",async()=>{
    const logical="organizations/org/visits/visit/documents/upload";
    const pending=pendingUploadObjectName(logical);
    const generations=new Map<string,Set<string>>([
      [logical,new Set(["31","32"])],
      [pending,new Set(["41","42"])],
    ]);
    const deleted:Array<{name:string;generation:string}>=[];
    const bucket={
      getFiles:vi.fn(async({prefix}:{prefix:string})=>[Array.from(generations.get(prefix)??[]).map(generation=>({name:prefix,metadata:{generation}}))]),
      file:vi.fn((name:string,options?:{generation?:string})=>({delete:vi.fn(async()=>{const generation=String(options?.generation);deleted.push({name,generation});generations.get(name)?.delete(generation);})})),
    } as unknown as Bucket;
    const storage={bucket:vi.fn(()=>bucket)} as unknown as Storage;
    const provider=createGcpStorageProvider({projectId:"project",bucket:"private"},storage);
    await provider.deleteIncompleteUpload(logical);
    expect(deleted).toEqual(expect.arrayContaining([
      {name:logical,generation:"31"},{name:logical,generation:"32"},
      {name:pending,generation:"41"},{name:pending,generation:"42"},
    ]));
    expect(generations.get(logical)?.size).toBe(0);
    expect(generations.get(pending)?.size).toBe(0);
  });

  it("promotes the verified quarantined generation once and removes its source generations",async()=>{
    const logical="organizations/org/visits/visit/documents/final";
    const pending=pendingUploadObjectName(logical);
    const sha256="a".repeat(64);
    const finalMetadata={generation:"52",size:"4",contentType:"application/pdf",metadata:{sha256}};
    const pendingMetadata={generation:"51",size:"4",contentType:"application/pdf",metadata:{sha256}};
    const finalFile={getMetadata:vi.fn().mockRejectedValueOnce({code:404}).mockResolvedValue([finalMetadata])};
    const pendingFile={getMetadata:vi.fn().mockResolvedValue([pendingMetadata])};
    const copy=vi.fn().mockResolvedValue(undefined);
    const pendingGenerations=new Set(["51"]);
    const bucket={
      getFiles:vi.fn(async({prefix}:{prefix:string})=>[prefix===pending?Array.from(pendingGenerations).map(generation=>({name:pending,metadata:{generation}})):[]]),
      file:vi.fn((name:string,options?:{generation?:string})=>{
        if(name===logical&&!options)return finalFile;
        if(name===pending&&!options)return pendingFile;
        if(name===pending&&options?.generation)return{copy,delete:vi.fn(async()=>{pendingGenerations.delete(String(options.generation));})};
        return{delete:vi.fn().mockResolvedValue(undefined)};
      }),
    } as unknown as Bucket;
    const storage={bucket:vi.fn(()=>bucket)} as unknown as Storage;
    const provider=createGcpStorageProvider({projectId:"project",bucket:"private"},storage);
    const declaration={organizationId:"org",objectName:logical,mimeType:"application/pdf",sizeBytes:4,sha256,expiresAt:new Date("2030-01-01T00:00:00Z")};
    await expect(provider.verify(declaration)).resolves.toMatchObject({objectName:logical,generation:"52",sha256});
    expect(copy).toHaveBeenCalledWith(finalFile,{preconditionOpts:{ifGenerationMatch:0}});
    expect(pendingGenerations.size).toBe(0);
  });
});
