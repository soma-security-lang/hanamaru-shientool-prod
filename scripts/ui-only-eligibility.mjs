#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const releaseFiles=new Set(['cloudbuild.web.yaml','scripts/release-blue-green.sh','scripts/release-ui-only.sh','scripts/ui-only-eligibility.mjs','scripts/ui-only-eligibility.test.mjs','scripts/ui-only-browser-gate.mjs']);
export function permittedUiPath(path){
 return path.startsWith('docs/')||releaseFiles.has(path)||path==='apps/web/src/components/shell/AppShell.tsx'||path==='apps/web/src/components/shell/AppShell.test.tsx'||/^apps\/web\/src\/.+\.css$/.test(path)||path==='apps/web/e2e/offline-stack.spec.ts'||path==='apps/web/playwright.config.ts'||path==='scripts/design-v07-browser.mjs';
}
export function validateBrowserEvidence(e){
 if(e.status!=='PASS'||e.formalBrowserGatePassed!==true||e.browserProject!=='chromium+webkit'||e.filter!==null||e.mode!=='offline-deterministic-browser-to-db'||e.screenshots<89||!/^[0-9a-f]{40}$/.test(e.gitSha??''))throw Error('Complete existing dual-browser/DB evidence is required');
}
export function inspectUiOnly(base,head,evidence){
 if(!/^[0-9a-f]{40}$/.test(base)||!/^[0-9a-f]{40}$/.test(head))throw Error('Exact commit SHAs required');
 execFileSync('git',['merge-base','--is-ancestor',base,head]);
 const paths=git('diff','--name-only',base,head).split('\n').filter(Boolean);
 if(!paths.length||paths.some(p=>!permittedUiPath(p)))throw Error('UI-only scope rejected: changes include unsupported product or release paths');
 validateBrowserEvidence(evidence);
 // Old evidence is reusable only when every deployed product tree is byte-identical.
 const productPaths=['apps/api','apps/worker','packages','apps/web/src','apps/web/package.json','apps/web/next.config.ts','apps/web/Dockerfile','package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];
 for(const path of productPaths)if(git('rev-parse',`${evidence.gitSha}:${path}`)!==git('rev-parse',`${head}:${path}`))throw Error(`Browser evidence product tree mismatch: ${path}`);
 return{status:'PASS',baseSha:base,sourceSha:head,changedPaths:paths,browserEvidenceSha:evidence.gitSha,browserEvidenceCompletedAt:evidence.completedAt,productTreesMatch:true,apiWorkerDatabaseChanged:false,liveGoogleAcceptance:evidence.googleAcceptance===true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const[, ,base,head,evidencePath]=process.argv;console.log(JSON.stringify(inspectUiOnly(base,head,JSON.parse(readFileSync(evidencePath,'utf8'))),null,2));}
 catch(e){console.error(e.message);process.exitCode=2;}
}
