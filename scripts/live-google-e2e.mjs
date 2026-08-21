#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  CHIRP3_MODEL,
  createGoogleAiProvider,
  createGoogleDriveProvider,
  createGoogleSpeechProvider,
} from "../packages/platform/dist/index.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing:${name}`);
  return value;
};

const safeFailure = (stage) => {
  console.error(`Google live E2E failed at ${stage}. Provider raw errors and credentials are intentionally not printed.`);
  process.exitCode = 1;
};

function audioMime(path) {
  const extension = extname(path).toLowerCase();
  const known = new Map([
    [".wav", "audio/wav"],
    [".flac", "audio/flac"],
    [".mp3", "audio/mpeg"],
    [".m4a", "audio/mp4"],
    [".mp4", "audio/mp4"],
    [".webm", "audio/webm"],
    [".ogg", "audio/ogg"],
  ]);
  return known.get(extension) ?? "application/octet-stream";
}

let stage = "configuration";
try {
  if (required("LIVE_E2E_DATA_CLASSIFICATION") !== "anonymous-approved") {
    throw new Error("unapproved-data");
  }

  const projectId = required("GCP_PROJECT_ID");
  const speechLocation = required("SPEECH_LOCATION");
  if (speechLocation !== "asia-northeast1" || required("SPEECH_MODEL") !== CHIRP3_MODEL) {
    throw new Error("speech-contract");
  }

  const pdfPath = resolve(required("LIVE_E2E_PDF_PATH"));
  const audioPath = resolve(required("LIVE_E2E_AUDIO_PATH"));
  const [pdf, audio] = await Promise.all([readFile(pdfPath), readFile(audioPath)]);
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("pdf-signature");

  stage = "audio-validation";
  const durationText = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  const durationSeconds = Number(durationText);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("audio-duration");

  stage = "vertex-pdf-extraction";
  const ai = createGoogleAiProvider({
    projectId,
    location: required("VERTEX_LOCATION"),
    model: required("VERTEX_AI_MODEL"),
    inputBucket: required("STT_INPUT_BUCKET"),
  });
  const extraction = await ai.extract({
    content: pdf,
    mimeType: "application/pdf",
    schema: {
      type: "OBJECT",
      required: ["fields"],
      properties: {
        fields: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["key", "value", "page", "excerpt", "confidence"],
            properties: {
              key: { type: "STRING" },
              value: { type: "STRING", nullable: true },
              page: { type: "INTEGER", nullable: true },
              excerpt: { type: "STRING", nullable: true },
              confidence: { type: "NUMBER", nullable: true },
            },
          },
        },
      },
    },
  });
  if (!extraction.model || extraction.fields.length === 0) throw new Error("empty-extraction");

  stage = "speech-v2-chirp3";
  const speech = createGoogleSpeechProvider({
    projectId,
    location: speechLocation,
    inputBucket: required("STT_INPUT_BUCKET"),
    model: CHIRP3_MODEL,
  });
  const transcript = await speech.transcribe({
    content: audio,
    mimeType: audioMime(audioPath),
    languageCode: "ja-JP",
    phrases: ["出張買取", "査定", "買取価格"],
  });
  if (transcript.provider !== "google-cloud-speech-to-text-v2" || transcript.model !== CHIRP3_MODEL) {
    throw new Error("wrong-stt-provider");
  }
  if (!transcript.fullText.trim() || transcript.segments.length === 0) throw new Error("empty-transcript");

  stage = "drive-file-scope";
  const drive = createGoogleDriveProvider({
    clientId: required("GOOGLE_DRIVE_CLIENT_ID"),
    clientSecret: required("GOOGLE_DRIVE_CLIENT_SECRET"),
    redirectUri: required("GOOGLE_DRIVE_REDIRECT_URI"),
  });
  const accessToken = await drive.refreshAccessToken(required("LIVE_E2E_GOOGLE_DRIVE_REFRESH_TOKEN"));
  stage = "drive-token-scope";
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("access_token", accessToken);
  const tokenInfoResponse = await fetch(tokenInfoUrl, { headers: { accept: "application/json" } });
  if (!tokenInfoResponse.ok) throw new Error("drive-tokeninfo");
  const tokenInfo = await tokenInfoResponse.json();
  const approvedDriveScope = "https://www.googleapis.com/auth/drive.file";
  const tokenScopes = new Set(String(tokenInfo.scope ?? "").split(/\s+/).filter(Boolean));
  if (tokenScopes.size !== 1 || !tokenScopes.has(approvedDriveScope)) throw new Error("drive-scope-not-minimal");
  stage = "drive-file-scope";
  const driveMetadata = await drive.inspectFile({
    accessToken,
    fileId: required("LIVE_E2E_GOOGLE_DRIVE_FILE_ID"),
  });
  if (!driveMetadata.mimeType.startsWith("audio/") || driveMetadata.sizeBytes <= 0) {
    throw new Error("drive-file-invalid");
  }
  const driveFile = await drive.openFile({
    accessToken,
    fileId: required("LIVE_E2E_GOOGLE_DRIVE_FILE_ID"),
  });
  let downloadedBytes = 0;
  for await (const chunk of driveFile.source) {
    downloadedBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    if (downloadedBytes > driveMetadata.sizeBytes) throw new Error("drive-file-size-overflow");
  }
  if (
    driveFile.mimeType !== driveMetadata.mimeType
    || driveFile.sizeBytes !== driveMetadata.sizeBytes
    || downloadedBytes !== driveMetadata.sizeBytes
    || (driveFile.sourceVersion && driveFile.sourceVersion !== driveMetadata.sourceVersion)
  ) {
    throw new Error("drive-file-invalid");
  }

  console.log(JSON.stringify({
    status: "PASS",
    dataClassification: "anonymous-approved",
    pdf: { provider: "vertex-ai", model: extraction.model, extractedFieldCount: extraction.fields.length },
    speech: {
      provider: transcript.provider,
      model: transcript.model,
      location: transcript.location,
      segmentCount: transcript.segments.length,
      hasSpeakerLabels: transcript.segments.some((segment) => Boolean(segment.speakerLabel)),
    },
    drive: { scope: "drive.file", mimeFamily: "audio", sizeVerified: true },
  }, null, 2));
} catch {
  safeFailure(stage);
}
