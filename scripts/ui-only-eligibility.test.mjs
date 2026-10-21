import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permittedUiPath,validateBrowserEvidence} from './ui-only-eligibility.mjs';
for(const path of ['apps/api/src/auth.ts','apps/worker/src/main.ts','packages/contracts/src/index.ts','packages/database/migrations/0071.sql','pnpm-lock.yaml','apps/web/src/lib/auth/google.ts','apps/web/src/components/auth/ViewerProvider.tsx','apps/web/next.config.ts','apps/web/Dockerfile','.github/workflows/deploy.yml','infra/terraform/main.tf'])test(`rejects incompatible change ${path}`,()=>assert.equal(permittedUiPath(path),false));
for(const path of ['apps/web/src/styles/tokens.css','apps/web/src/components/shell/AppShell.tsx','scripts/release-ui-only.sh','docs/migration/2026-10-21-ui-only-release.md'])test(`accepts scoped UI/release evidence ${path}`,()=>assert.equal(permittedUiPath(path),true));
const valid={status:'PASS',formalBrowserGatePassed:true,browserProject:'chromium+webkit',filter:null,mode:'offline-deterministic-browser-to-db',screenshots:89,gitSha:'a'.repeat(40)};
test('rejects filtered, failed, single-engine or incomplete browser proof',()=>{for(const patch of [{status:'FAIL'},{formalBrowserGatePassed:false},{filter:'one scenario'},{browserProject:'chromium'},{screenshots:1},{gitSha:'short'}])assert.throws(()=>validateBrowserEvidence({...valid,...patch}));});
test('accepts complete proof without claiming live Google acceptance',()=>assert.doesNotThrow(()=>validateBrowserEvidence({...valid,googleAcceptance:false})));

const {isBusinessMutation}=await import('./ui-only-browser-gate.mjs');
for(const method of ['POST','PUT','PATCH','DELETE'])test(`live UI fence blocks ${method} business requests`,()=>assert.equal(isBusinessMutation({url:()=> 'https://hanamaru-pilot-api-tpqjzqidwa-an.a.run.app/api/v1/visits',method:()=>method}),true));
for(const method of ['GET','HEAD','OPTIONS'])test(`live UI fence permits ${method} reads`,()=>assert.equal(isBusinessMutation({url:()=> 'https://hanamaru-pilot-api-tpqjzqidwa-an.a.run.app/api/v1/me',method:()=>method}),false));
