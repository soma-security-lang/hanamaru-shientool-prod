#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {validateBrowserEvidence} from './ui-only-eligibility.mjs';

const require=createRequire(import.meta.url);
// Reuse the audited YAML reader already required by the root ESLint toolchain.
const yaml=createRequire(require.resolve('eslint/package.json'))('js-yaml');
export const webBase='09d6fb1432e85a8bebd5342df078c2baba18e6ad';
export const backendBase='9a70aba8e2e9c8292609e553c874e222586a5ae3';
const approvedLockHash='58e98bae8b2da78553fcd043aeb516c0b2dba02adae7c43e2cfe2d7c9d87a74a';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd();
const source=(sha,path)=>git('show',`${sha}:${path}`)+'\n';
const nextFamily=name=>name==='next'||name==='eslint-config-next'||/^@next\/(env|eslint-plugin-next|swc-(darwin-(arm64|x64)|linux-(arm64|x64)-(gnu|musl)|win32-(arm64|x64)-msvc))$/.test(name);
const keyPattern=/^(next|eslint-config-next|@next\/[^@]+)@(16\.3\.8|16\.4\.1)(?=\(|$)/;

export function validateNextManifest(before,after){
 const normalized=structuredClone(after);
 assert.equal(before.dependencies.next,'16.3.8');assert.equal(after.dependencies.next,'16.4.1');
 assert.equal(before.devDependencies['eslint-config-next'],'16.3.8');assert.equal(after.devDependencies['eslint-config-next'],'16.4.1');
 normalized.dependencies.next=before.dependencies.next;
 normalized.devDependencies['eslint-config-next']=before.devDependencies['eslint-config-next'];
 assert.deepEqual(normalized,before,'Only the approved Next and matching ESLint versions may change');
}

export function validateNextLock(before,after){
 const normalized=structuredClone(after), original=structuredClone(before);
 for(const [group,name] of [['dependencies','next'],['devDependencies','eslint-config-next']]){
  const old=original.importers['apps/web'][group][name], current=normalized.importers['apps/web'][group][name];
  assert.equal(old.specifier,'16.3.8');assert.equal(current.specifier,'16.4.1');
  assert.equal(current.version.replace(/^16\.4\.1(?=\(|$)/,'16.3.8'),old.version);
  normalized.importers['apps/web'][group][name]=old;
 }
 function normalizeGraph(map,isCandidate){
  const output={};
  for(const [key,raw] of Object.entries(map)){
   const record=structuredClone(raw), match=key.match(keyPattern);
   if(match&&nextFamily(match[1])){
    assert.equal(match[2],isCandidate?'16.4.1':'16.3.8','Mixed or old Next artifacts are forbidden');
    if(record.resolution){assert.match(record.resolution.integrity??'',/^sha512-[A-Za-z0-9+/]+=*$/);delete record.resolution.integrity;}
    for(const group of ['dependencies','optionalDependencies'])for(const [name,version] of Object.entries(record[group]??{})){
     if(nextFamily(name))record[group][name]=version.replace(/^16\.4\.1(?=\(|$)/,'16.3.8');
    }
    output[key.replace('@16.4.1','@16.3.8')]=record;
   }else output[key]=record;
  }
  return output;
 }
 for(const group of ['packages','snapshots']){
  original[group]=normalizeGraph(original[group],false);
  normalized[group]=normalizeGraph(normalized[group],true);
 }
 assert.deepEqual(normalized,original,'Unrelated importer, override, resolution or transitive dependency changed');
}

const reviewedReleasePaths=new Set([
 'cloudbuild.web.yaml','scripts/release-ui-only.sh','scripts/release-web-security.sh',
 'scripts/web-security-eligibility.mjs','scripts/web-security-eligibility.test.mjs',
 'apps/web/package.json','pnpm-lock.yaml','apps/web/e2e/offline-stack.spec.ts','apps/web/playwright.config.ts',
 'apps/web/src/components/technical-details/TechnicalDetails.module.css','AGENTS.md','apps/web/AGENTS.md',
]);
export const permittedWebSecurityPath=path=>path.startsWith('docs/')||reviewedReleasePaths.has(path);
export function validateReviewedLock(raw){
 assert.equal(createHash('sha256').update(raw).digest('hex'),approvedLockHash,'Only the independently reviewed lock bytes are approved');
}

export function inspectWebSecurity(base,head,evidence){
 assert.equal(base,webBase,'This reviewed one-release profile has a fixed Web baseline');
 assert.match(head,/^[0-9a-f]{40}$/);
 execFileSync('git',['merge-base','--is-ancestor',base,head]);
 const paths=git('diff','--name-only',base,head).split('\n').filter(Boolean);
 assert.ok(paths.length&&paths.every(permittedWebSecurityPath),'Unsupported Web security update path');
 validateNextManifest(JSON.parse(source(base,'apps/web/package.json')),JSON.parse(source(head,'apps/web/package.json')));
 const lock=source(head,'pnpm-lock.yaml');
 validateNextLock(yaml.load(source(base,'pnpm-lock.yaml'),{schema:yaml.JSON_SCHEMA}),yaml.load(lock,{schema:yaml.JSON_SCHEMA}));
 validateReviewedLock(lock);
 for(const path of ['AGENTS.md','apps/web/AGENTS.md']){
  const old=source(base,path), current=source(head,path);
  assert.ok(current===old||current===old.replace(/^# This is NOT the Next\.js you know$/m,'## This is NOT the Next.js you know'),'Only the automatic Next heading update is permitted');
 }
 // A Web-only release has separate immutable backend provenance. Do not relabel it.
 for(const path of ['apps/api','apps/worker','packages'])assert.equal(git('rev-parse',`${backendBase}:${path}`),git('rev-parse',`${head}:${path}`),`Backend tree differs: ${path}`);
 validateBrowserEvidence(evidence);
 assert.equal(evidence.workingTreeDirty,false,'Browser verification requires a clean candidate checkout');
 for(const path of ['apps/api','apps/worker','packages','apps/web/src','apps/web/package.json','apps/web/next.config.ts','apps/web/Dockerfile','package.json','pnpm-lock.yaml','pnpm-workspace.yaml'])
  assert.equal(git('rev-parse',`${evidence.gitSha}:${path}`),git('rev-parse',`${head}:${path}`),`Fresh browser evidence mismatch: ${path}`);
 return{status:'PASS',profile:'next-security-20261023',baseSha:base,backendBaseSha:backendBase,sourceSha:head,
  versions:{before:'16.3.8',after:'16.4.1'},advisories:['GHSA-2464-fhr4-w9xw','GHSA-673q-mjm6-r5xr','GHSA-p3m5-59mp-jv5r'],
  changedPaths:paths,browserEvidenceSha:evidence.gitSha,browserEvidenceCompletedAt:evidence.completedAt,productTreesMatch:true,apiWorkerDatabaseChanged:false,liveGoogleAcceptance:evidence.googleAcceptance===true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const[,,base,head,evidence]=process.argv;console.log(JSON.stringify(inspectWebSecurity(base,head,JSON.parse(readFileSync(evidence,'utf8'))),null,2));}
 catch(error){console.error(error.message);process.exitCode=2;}
}
