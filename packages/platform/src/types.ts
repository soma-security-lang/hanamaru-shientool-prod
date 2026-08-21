import type { AudioMetadata,VideoMetadata } from "./media.js";
import type { Readable } from "node:stream";

export interface UploadDeclaration {
  organizationId: string; objectName: string; mimeType: string; sizeBytes: number; sha256: string; expiresAt: Date;
}
export interface SignedUpload { url: string; method: "PUT"; headers: Record<string,string>; expiresAt: string; }
export interface StoredObject { bucket: string; objectName: string; generation: string; sizeBytes: number; sha256: string; mimeType: string; }
export type DownloadAccess =
  | { kind: "inline"; body: Buffer; mimeType: string }
  | { kind: "stream"; source:Readable; mimeType:string; totalSize:number; start:number; end:number; partial:boolean }
  | { kind: "range_invalid"; totalSize:number }
  | { kind: "redirect"; url: string; expiresAt: string };
export interface StorageProvider {
  createUpload(input: UploadDeclaration): Promise<SignedUpload>;
  put(input: { organizationId:string; objectName:string; mimeType:string; body:Buffer; sha256?:string }): Promise<StoredObject>;
  putStream(input:{organizationId:string;objectName:string;mimeType:string;source:Readable;sizeBytes:number;sha256?:string}):Promise<StoredObject>;
  openRead(objectName:string,generation:string,range?:{start:number;end:number}):Promise<Readable>;
  probeAudio(objectName:string,generation:string):Promise<AudioMetadata>;
  probeVideo(objectName:string,generation:string):Promise<VideoMetadata>;
  createDownload(objectName: string, generation: string, mimeType: string, expiresAt: Date): Promise<DownloadAccess>;
  verify(input: UploadDeclaration): Promise<StoredObject>;
  /** Delete an expired upload that has not reached storage_objects yet, including any partially promoted copy. */
  deleteIncompleteUpload(objectName:string):Promise<void>;
  /** Delete every generation for this logical object name. The tracked generation is required for audit/sanity validation. */
  delete(objectName: string, generation: string): Promise<void>;
}
export interface TaskProvider { dispatch(jobId: string, jobType: string, dispatchId: string): Promise<{ taskName: string }>; }
export interface SpeechTranscriptionResult {
  provider: "google-cloud-speech-to-text-v2"|"test-fixture";
  model: "chirp_3"|"test-fixture";
  location: string;
  providerOperationId: string;
  fullText: string;
  segments: Array<{
    startMs:number;
    endMs:number;
    speakerLabel:string|null;
    speakerRole:"staff"|"customer"|"unknown";
    text:string;
    confidence:number|null;
  }>;
}
export interface SpeechTranscriptionInput {
  uri?: string;
  content?: Buffer;
  stream?: Readable;
  sizeBytes?: number;
  /** Verified media duration. Required by the GCP adapter for safe Chirp 3 chunking. */
  durationMs?: number;
  mimeType: string;
  languageCode: string;
  phrases?: string[];
}
export interface SpeechProvider {
  /** Synchronous adapter used only by deterministic local fixtures. */
  transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult>;
  /** Starts one durable Google BatchRecognize LRO and returns without waiting. */
  startTranscription?(input: SpeechTranscriptionInput):Promise<{
    providerOperationId:string;
    cleanupToken:string|null;
  }>;
  /** Polls the existing LRO exactly once. It must never start a second operation. */
  pollTranscription?(providerOperationId:string):Promise<
    | {status:"pending"}
    | {status:"succeeded";result:SpeechTranscriptionResult}
  >;
  /** Removes a temporary provider input after a terminal outcome. */
  cleanupTranscription?(cleanupToken:string|null):Promise<void>;
  /** Cancels every provider LRO in a durable transcription and removes its temporary data. */
  cancelTranscription?(providerOperationId:string,cleanupToken:string|null):Promise<void>;
}
export interface AiProvider {
  extract(input: { text?: string; content?:Buffer; sourceUri?: string; mimeType?: string; schema: Record<string,unknown> }): Promise<{ model:string; fields:Array<{ key:string; value:unknown; page:number|null; excerpt:string|null; confidence:number|null }> }>;
  prepareVisit(input:{
    extractedFields:Array<{key:string;value:unknown;sourcePage:number|null;sourceExcerpt:string|null}>;
    knowledge:Array<{id:string;type:"talk"|"legal"|"manual";title:string;body:unknown}>;
  }):Promise<{
    model:string;
    customerFacts:Array<{label:string;value:string;sourceFieldKey:string|null}>;
    anticipatedPsychology:Array<{title:string;description:string;basisFieldKeys:string[]}>;
    legalChecks:Array<{title:string;description:string;sourceContentIds:string[]}>;
    suggestedTalks:Array<{title:string;script:string;sourceContentIds:string[]}>;
    anticipatedQuestions:Array<{question:string;answer:string;sourceContentIds:string[]}>;
  }>;
  answerKnowledge(input:{question:string;knowledge:Array<{id:string;type:string;title:string;body:unknown}>}):Promise<{model:string;answer:string;citationIds:string[];suggestedQuestions:string[]}>;
  assessTranscriptQuality(input:{
    durationMs:number;
    segments:Array<{id:string;startMs:number;endMs:number;speakerLabel:string|null;text:string}>;
  }):Promise<{
    model:string;
    flags:Array<{
      type:"possible_media"|"long_non_dialogue";
      confidence:number;
      evidenceSegmentIds:string[];
    }>;
  }>;
  review(input: { transcript: string; segments: Array<{ id:string; text:string }>; objective?: string; systemInstruction?:string; criteria?:unknown; promptVersion?:number; criteriaVersion?:number; modelName?:string }): Promise<{ model:string; summary:string; findings:Array<{ category:string; title:string; description:string; recommendedAction:string|null; evidenceSegmentIds:string[] }> }>;
  roleplay(input:{scenarioTitle:string;customerProfile:string;messages:Array<{role:"staff"|"customer";text:string}>}):Promise<{model:string;customerReply:string;feedback:Array<{category:string;message:string}>}>;
}
export interface DriveProvider {
  exchangeAuthorizationCode(code:string):Promise<{providerAccountId:string;refreshToken:string;accessToken:string;expiresAt:string;scopes:string[]}>;
  refreshAccessToken(refreshToken:string):Promise<string>;
  revoke(token:string):Promise<void>;
  inspectFile(input:{accessToken:string;fileId:string}):Promise<{name:string|null;mimeType:string;sizeBytes:number;sourceVersion:string;modifiedTime:string|null}>;
  openFile(input:{accessToken:string;fileId:string}):Promise<{source:Readable;mimeType:string;sizeBytes:number;sourceVersion:string|null;modifiedTime:string|null}>;
}
export interface TokenCipher { keyVersion:string; encrypt(plainText:string):Buffer; decrypt(cipherText:Buffer):string; }
export interface PlatformProviders { storage: StorageProvider; tasks: TaskProvider; speech: SpeechProvider; ai: AiProvider; drive: DriveProvider; mode: "local"|"local-connected"|"gcp"; }
