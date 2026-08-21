import { Readable } from "node:stream";
import { describe,expect,it } from "vitest";
import { probeAudioStream } from "./media.js";

function monoPcmWav(durationSeconds=1,sampleRate=16_000):Buffer{
  const sampleCount=durationSeconds*sampleRate;
  const dataBytes=sampleCount*2;
  const body=Buffer.alloc(44+dataBytes);
  body.write("RIFF",0);
  body.writeUInt32LE(36+dataBytes,4);
  body.write("WAVEfmt ",8);
  body.writeUInt32LE(16,16);
  body.writeUInt16LE(1,20);
  body.writeUInt16LE(1,22);
  body.writeUInt32LE(sampleRate,24);
  body.writeUInt32LE(sampleRate*2,28);
  body.writeUInt16LE(2,32);
  body.writeUInt16LE(16,34);
  body.write("data",36);
  body.writeUInt32LE(dataBytes,40);
  return body;
}

describe("audio media inspection",()=>{
  it("uses ffprobe against a stream and returns server-derived metadata",async()=>{
    const wav=monoPcmWav();
    const metadata=await probeAudioStream(Readable.from([wav.subarray(0,113),wav.subarray(113)]));
    expect(metadata).toMatchObject({codec:"pcm_s16le",durationMs:1000,sampleRate:16_000,channels:1});
  });

  it("rejects bytes that only claim to be audio",async()=>{
    await expect(probeAudioStream(Readable.from([Buffer.from("not audio")]))).rejects.toThrow("音声ファイルを解析できません");
  });
});
