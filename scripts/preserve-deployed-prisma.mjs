// Build artifact repair only: retain the generated client from the same frozen
// workspace build when pnpm's isolated production graph creates a client stub.
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { cpSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function assertDeployTarget(source, target, root) {
  assert.ok(target.startsWith(root + sep), 'Generated client must stay inside the isolated deployment');
  assert.ok(!source.startsWith(root + sep) && source !== target, 'Source client is read-only');
  assert.ok(target.endsWith(`${sep}node_modules${sep}.prisma${sep}client`), 'Only the generated Prisma client may be replaced');
  assert.ok(source.endsWith(`${sep}node_modules${sep}.prisma${sep}client`));
}
export function preserveDeployedPrisma(sourceManifest, targetManifest) {
  const source = createRequire(sourceManifest);
  const targetRoot = realpathSync(dirname(targetManifest));
  const target = createRequire(createRequire(targetManifest).resolve('@hanamaru/alignment'));
  const sourceClient = source.resolve('@prisma/client/package.json');
  const targetClient = target.resolve('@prisma/client/package.json');
  assert.equal(JSON.parse(readFileSync(sourceClient)).version, '6.19.3');
  assert.equal(JSON.parse(readFileSync(targetClient)).version, '6.19.3');
  const from = realpathSync(dirname(createRequire(sourceClient).resolve('.prisma/client/package.json')));
  const to = resolve(dirname(targetClient), '../..', '.prisma/client');
  assertDeployTarget(from, to, targetRoot);
  assert.ok(readFileSync(resolve(from, 'schema.prisma'), 'utf8').includes('model AlignmentSession'));
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  assert.deepEqual(readFileSync(resolve(from, 'schema.prisma')), readFileSync(resolve(to, 'schema.prisma')));
  console.info('GENERATED_PRISMA_DEPLOY_ARTIFACT_PRESERVED_NO_SCHEMA_OR_DB_CHANGE');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4);
  preserveDeployedPrisma(resolve(process.argv[2]), resolve(process.argv[3]));
}
