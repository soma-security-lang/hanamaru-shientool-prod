import {Blob as NodeBlob} from "node:buffer";
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {IncrementalSha256,sha256Blob} from "./sha256";

const encoder=new TextEncoder();

describe("streaming SHA-256",()=>{
  it("matches the empty and abc standard vectors",()=>{
    expect(new IncrementalSha256().digestHex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(new IncrementalSha256().update(encoder.encode("abc")).digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("preserves block boundaries across many small chunks",()=>{
    const hash=new IncrementalSha256();
    for(const part of ["The quick ","brown fox ","jumps over ","the lazy dog"])hash.update(encoder.encode(part));
    expect(hash.digestHex()).toBe("d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");
  });

  it("reads a Blob as a stream instead of materializing an ArrayBuffer",async()=>{
    const bytes=new Uint8Array(256*1024+37);for(let index=0;index<bytes.length;index++)bytes[index]=index%251;
    const blob=new NodeBlob([bytes]) as unknown as Blob;
    Object.defineProperty(blob,"arrayBuffer",{value:()=>{throw new Error("全量読込は禁止");}});
    await expect(sha256Blob(blob)).resolves.toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
