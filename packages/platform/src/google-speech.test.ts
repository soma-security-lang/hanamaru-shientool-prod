import {describe,expect,it} from "vitest";
import {buildChirp3BatchRequest,chirp3ChunkPlan,mergeChirp3Chunks,parseChirp3BatchResponse} from "./google-speech.js";

describe("Google Speech-to-Text V2 chirp_3",()=>{
  it("builds the fixed model, Tokyo recognizer and diarization without incompatible adaptation",()=>{
    const request=buildChirp3BatchRequest({projectId:"project-1",location:"asia-northeast1",inputBucket:"private",model:"chirp_3"},"gs://private/audio.m4a","ja-JP",["ロレックス","ロレックス","18金"],"gs://private/local-validation/stt-input/run/output/");
    expect(request).toMatchObject({recognizer:"projects/project-1/locations/asia-northeast1/recognizers/_",config:{model:"chirp_3",languageCodes:["ja-JP"],features:{enableAutomaticPunctuation:true,enableWordTimeOffsets:true,diarizationConfig:{minSpeakerCount:2,maxSpeakerCount:2}},denoiserConfig:{denoiseAudio:true}},files:[{uri:"gs://private/audio.m4a"}],recognitionOutputConfig:{gcsOutputConfig:{uri:"gs://private/local-validation/stt-input/run/output/"},outputFormatConfig:{native:{},srt:{}}}});
    expect(request.config).not.toHaveProperty("adaptation");
  });

  it("targets the configured multi-region without changing the Chirp 3 model",()=>{
    expect(buildChirp3BatchRequest({projectId:"project-1",location:"us",inputBucket:"private",model:"chirp_3"},"gs://private/audio.flac","ja-JP")).toMatchObject({
      recognizer:"projects/project-1/locations/us/recognizers/_",
      config:{model:"chirp_3",languageCodes:["ja-JP"]},
    });
  });

  it("keeps provider speaker labels and merges adjacent words without inventing roles",()=>{
    const response={results:{"gs://private/audio.m4a":{inlineResult:{transcript:{results:[{alternatives:[{transcript:"本日はありがとうございます。 査定をお願いします。",confidence:.91,words:[
      {word:"本日は",speakerLabel:"1",startOffset:{seconds:0},endOffset:{seconds:1},confidence:.95},
      {word:"ありがとうございます。",speakerLabel:"1",startOffset:{seconds:1},endOffset:{seconds:2},confidence:.94},
      {word:"査定を",speakerLabel:"2",startOffset:{seconds:3},endOffset:{seconds:4},confidence:.9},
      {word:"お願いします。",speakerLabel:"2",startOffset:{seconds:4},endOffset:{seconds:5},confidence:.89}
    ]}]}]}}}}};
    const parsed=parseChirp3BatchResponse(response,"operations/123","asia-northeast1");
    expect(parsed).toMatchObject({provider:"google-cloud-speech-to-text-v2",model:"chirp_3",location:"asia-northeast1",providerOperationId:"operations/123"});
    expect(parsed.segments).toEqual([
      {startMs:0,endMs:2000,speakerLabel:"1",speakerRole:"unknown",text:"本日はありがとうございます。",confidence:.94},
      {startMs:3000,endMs:5000,speakerLabel:"2",speakerRole:"unknown",text:"査定をお願いします。",confidence:.89}
    ]);
  });

  it("parses the native BatchRecognizeResults JSON written to GCS",()=>{
    const parsed=parseChirp3BatchResponse({results:[{alternatives:[{transcript:"査定を始めます。",words:[{word:"査定を",speakerLabel:"1",startOffset:"1.25s",endOffset:"2s"},{word:"始めます。",speakerLabel:"1",startOffset:"2s",endOffset:"3.5s"}]}]}]},"operations/gcs","us");
    expect(parsed.fullText).toBe("査定を始めます。");
    expect(parsed.segments).toEqual([{startMs:1250,endMs:3500,speakerLabel:"1",speakerRole:"unknown",text:"査定を始めます。",confidence:null}]);
  });

  it("uses provider SRT cues for monotonic segments when Chirp 3 omits word offsets",()=>{
    const response={results:[{alternatives:[{transcript:"本日はありがとうございます。査定をお願いします。",words:[{word:"本日は",speakerLabel:"1"},{word:"ありがとうございます。",speakerLabel:"1"},{word:"査定を",speakerLabel:"2"},{word:"お願いします。",speakerLabel:"2"}]}]}]};
    const srt="1\n00:00:01,000 --> 00:00:03,000\n本日はありがとうございます。\n\n2\n00:00:04,000 --> 00:00:06,500\n査定をお願いします。\n";
    const parsed=parseChirp3BatchResponse(response,"operations/srt","us",srt);
    expect(parsed.segments).toEqual([
      {startMs:1000,endMs:3000,speakerLabel:"1",speakerRole:"unknown",text:"本日はありがとうございます。",confidence:null},
      {startMs:4000,endMs:6500,speakerLabel:"2",speakerRole:"unknown",text:"査定をお願いします。",confidence:null},
    ]);
  });

  it("splits timestamped audio below the Google 20 minute boundary",()=>{
    expect(chirp3ChunkPlan(45*60*1000+1000)).toEqual([
      {index:0,startMs:0,durationMs:19*60*1000},
      {index:1,startMs:19*60*1000,durationMs:19*60*1000},
      {index:2,startMs:38*60*1000,durationMs:7*60*1000+1000},
    ]);
  });

  it("uses smaller chunks for recordings longer than one hour",()=>{
    expect(chirp3ChunkPlan(81*60*1000)).toEqual([
      {index:0,startMs:0,durationMs:10*60*1000},
      {index:1,startMs:10*60*1000,durationMs:10*60*1000},
      {index:2,startMs:20*60*1000,durationMs:10*60*1000},
      {index:3,startMs:30*60*1000,durationMs:10*60*1000},
      {index:4,startMs:40*60*1000,durationMs:10*60*1000},
      {index:5,startMs:50*60*1000,durationMs:10*60*1000},
      {index:6,startMs:60*60*1000,durationMs:10*60*1000},
      {index:7,startMs:70*60*1000,durationMs:10*60*1000},
      {index:8,startMs:80*60*1000,durationMs:60*1000},
    ]);
    expect(chirp3ChunkPlan(8*60*60*1000)).toHaveLength(48);
  });

  it("offsets chunk timelines and namespaces diarization labels",()=>{
    const base=(text:string,label:string)=>({provider:"google-cloud-speech-to-text-v2" as const,model:"chirp_3" as const,location:"us",providerOperationId:"operation",fullText:text,segments:[{startMs:1000,endMs:3000,speakerLabel:label,speakerRole:"unknown" as const,text,confidence:.9}]});
    const merged=mergeChirp3Chunks([{startMs:0,result:base("前半","1")},{startMs:19*60*1000,result:base("後半","1")}],"composite-operation");
    expect(merged.fullText).toBe("前半\n後半");
    expect(merged.segments).toEqual([
      {startMs:1000,endMs:3000,speakerLabel:"chunk-1:1",speakerRole:"unknown",text:"前半",confidence:.9},
      {startMs:19*60*1000+1000,endMs:19*60*1000+3000,speakerLabel:"chunk-2:1",speakerRole:"unknown",text:"後半",confidence:.9},
    ]);
  });

  it("clips codec-frame overlap at the next chunk boundary",()=>{
    const result=(text:string,startMs:number,endMs:number)=>({provider:"google-cloud-speech-to-text-v2" as const,model:"chirp_3" as const,location:"us",providerOperationId:"operation",fullText:text,segments:[{startMs,endMs,speakerLabel:"1",speakerRole:"unknown" as const,text,confidence:.9}]});
    const boundary=19*60*1000;
    const merged=mergeChirp3Chunks([
      {startMs:0,result:result("前半",boundary-1000,boundary+12)},
      {startMs:boundary,result:result("後半",0,2000)},
    ],"composite-operation");
    expect(merged.segments).toEqual([
      {startMs:boundary-1000,endMs:boundary,speakerLabel:"chunk-1:1",speakerRole:"unknown",text:"前半",confidence:.9},
      {startMs:boundary,endMs:boundary+2000,speakerLabel:"chunk-2:1",speakerRole:"unknown",text:"後半",confidence:.9},
    ]);
  });
});
