import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webBase,validateNextManifest,validateNextLock,validateReviewedLock,permittedWebSecurityPath} from './web-security-eligibility.mjs';
import {permittedUiPath} from './ui-only-eligibility.mjs';
const require=createRequire(import.meta.url);
const yaml=createRequire(require.resolve('eslint/package.json'))('js-yaml');
// Contract fixtures deliberately have no dependency on Git history: Cloud Build
// receives a source archive. The release CLI independently compares real Git trees.
const beforeManifest={scripts:{build:'next build'},dependencies:{next:'16.3.8',firebase:'12.0.0',react:'19.0.0'},devDependencies:{'eslint-config-next':'16.3.8'}};
const afterManifest=structuredClone(beforeManifest);
afterManifest.dependencies.next='16.4.1';afterManifest.devDependencies['eslint-config-next']='16.4.1';
const rawLock=readFileSync('pnpm-lock.yaml','utf8');
const lockFixture=version=>({lockfileVersion:'9.0',overrides:{sharp:'0.35.5'},importers:{
 'apps/web':{dependencies:{next:{specifier:version,version}},devDependencies:{'eslint-config-next':{specifier:version,version}}},
 'apps/api':{dependencies:{fastify:{specifier:'5.0.0',version:'5.0.0'}}}},
 packages:{[`next@${version}`]:{resolution:{integrity:'sha512-YQ=='}},[`eslint-config-next@${version}`]:{resolution:{integrity:'sha512-Yg=='}},'qs@6.15.3':{resolution:{integrity:'sha512-Yw=='}}},
 snapshots:{[`next@${version}`]:{dependencies:{'@next/env':version,react:'19.0.0'}},[`eslint-config-next@${version}`]:{dependencies:{'@next/eslint-plugin-next':version}}}});
const beforeLock=lockFixture('16.3.8'),afterLock=lockFixture('16.4.1');
test('actual candidate manifest and YAML are the approved versions',()=>{
 const manifest=JSON.parse(readFileSync('apps/web/package.json','utf8'));
 const lock=yaml.load(rawLock,{schema:yaml.JSON_SCHEMA});
 assert.equal(manifest.dependencies.next,'16.4.1');assert.equal(manifest.devDependencies['eslint-config-next'],'16.4.1');
 assert.equal(lock.importers['apps/web'].dependencies.next.specifier,'16.4.1');
});

test('permits only the exact Next and matching ESLint update',()=>assert.doesNotThrow(()=>validateNextManifest(beforeManifest,afterManifest)));
for(const [name,mutate] of [
 ['firebase version',m=>m.dependencies.firebase='*'],
 ['React version',m=>m.dependencies.react='20.0.0'],
 ['new BFF package',m=>m.dependencies['@hanamaru/alignment']='workspace:*'],
 ['new build script',m=>m.scripts.build='echo bypass'],
 ['version range',m=>m.dependencies.next='^16.4.1'],
 ['mismatched ESLint',m=>m.devDependencies['eslint-config-next']='16.4.2'],
])test(`rejects manifest drift: ${name}`,()=>{const changed=structuredClone(afterManifest);mutate(changed);assert.throws(()=>validateNextManifest(beforeManifest,changed));});

test('accepts reviewed Next-only lock graph with all other importers unchanged',()=>assert.doesNotThrow(()=>validateNextLock(beforeLock,afterLock)));
for(const [name,mutate] of [
 ['backend dependency',l=>l.importers['apps/api'].dependencies.fastify.specifier='*'],
 ['non-Web importer',l=>l.importers['packages/alien']={dependencies:{next:{specifier:'16.4.1',version:'16.4.1'}}}],
 ['shared sharp override',l=>l.overrides.sharp='0.35.4'],
 ['new unknown package',l=>l.packages['unrelated@1.0.0']={resolution:{integrity:'sha512-YQ=='}}],
 ['unrelated integrity',l=>l.packages['qs@6.15.3'].resolution.integrity='sha512-YQ=='],
 ['transitive dependency',l=>{const k=Object.keys(l.snapshots).find(k=>k.startsWith('next@16.4.1'));l.snapshots[k].dependencies.react='0.0.0';}],
])test(`rejects lock drift: ${name}`,()=>{const changed=structuredClone(afterLock);mutate(changed);assert.throws(()=>validateNextLock(beforeLock,changed));});
test('pins the actual reviewed integrity bytes, not just semantically equal YAML',()=>{
 assert.doesNotThrow(()=>validateReviewedLock(rawLock));
 assert.throws(()=>validateReviewedLock(rawLock+'# unreviewed\n'));
 assert.throws(()=>validateReviewedLock(rawLock.replace('sha512-uc657','sha512-ac657')));
});
for(const path of ['apps/web/package.json','pnpm-lock.yaml'])test(`ordinary UI-only profile still rejects ${path}`,()=>assert.equal(permittedUiPath(path),false));
for(const path of ['apps/api/src/auth.ts','apps/worker/Dockerfile','packages/database/migrations/0071.sql','apps/web/src/lib/auth/google.ts','apps/web/src/proxy.ts','apps/web/next.config.ts','apps/web/Dockerfile','.github/workflows/deploy.yml','infra/terraform/main.tf','pnpm-workspace.yaml','package.json'])
 test(`Web security profile still rejects ${path}`,()=>assert.equal(permittedWebSecurityPath(path),false));
test('rejects unknown release profile before any GCP operation',()=>{
 const run=spawnSync('bash',['scripts/release-ui-only.sh'],{encoding:'utf8',env:{...process.env,
  GCP_ACCOUNT:'synthetic-operator',UI_RELEASE_BASE_SHA:webBase,WEB_IMAGE:'synthetic',BUILD_ID:'synthetic',
  UI_BROWSER_EVIDENCE:'synthetic',UI_GATE_REQUEST_FILE:'synthetic',UI_GATE_STATUS_FILE:'synthetic',UI_DRIFT_EVIDENCE:'synthetic',WEB_RELEASE_PROFILE:'unknown'}});
 assert.equal(run.status,2);assert.match(run.stderr,/Unknown Web release profile/);
});
