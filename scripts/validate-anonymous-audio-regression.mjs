#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath=process.argv[2];
if(!manifestPath){
  console.error("manifest path is required");
  process.exit(2);
}

const manifest=JSON.parse(readFileSync(resolve(manifestPath),"utf8"));
const expected=new Map([
  ["normal_dialogue",[]],
  ["multi_speaker",["many_speakers"]],
  ["media_mix",["possible_media","long_non_dialogue"]],
]);
const forbiddenKeys=new Set(["localPath","body","text","transcript","segments","email","token"]);
const failures=[];

if(manifest.schemaVersion!==1)failures.push("schemaVersion must be 1");
if(!Array.isArray(manifest.profiles)||manifest.profiles.length!==3)failures.push("exactly three profiles are required");

for(const entry of manifest.profiles??[]){
  if(!expected.has(entry.profile)){failures.push("unknown profile");continue;}
  for(const key of Object.keys(entry))if(forbiddenKeys.has(key))failures.push(`${entry.profile}: forbidden manifest key ${key}`);
  if(!/^gs:\/\/[^/]+\/anonymous-regression\//.test(entry.gcsUri??""))failures.push(`${entry.profile}: private GCS URI is required`);
  if(!/^[1-9][0-9]*$/.test(String(entry.generation??"")))failures.push(`${entry.profile}: object generation is required`);
  if(!/^[0-9a-f]{64}$/.test(entry.sha256??""))failures.push(`${entry.profile}: SHA-256 is invalid`);
  if(!(Number.isFinite(entry.durationSeconds)&&entry.durationSeconds>0))failures.push(`${entry.profile}: duration must be positive`);
  if(!["mp3","aac","flac","wav","opus"].includes(entry.codec))failures.push(`${entry.profile}: codec is not allowed`);
  const actualFlags=[...(entry.expectedQualityFlags??[])].sort();
  const expectedFlags=[...expected.get(entry.profile)].sort();
  if(JSON.stringify(actualFlags)!==JSON.stringify(expectedFlags))failures.push(`${entry.profile}: expected quality flags drifted`);
}

for(const profile of expected.keys())if(!(manifest.profiles??[]).some((entry)=>entry.profile===profile))failures.push(`${profile}: profile is missing`);

if(failures.length){
  failures.forEach((failure)=>console.error(`anonymous audio manifest: ${failure}`));
  process.exit(1);
}
console.log(JSON.stringify({status:"PASS",profiles:3,privateObjects:3,transcriptMaterial:0}));
