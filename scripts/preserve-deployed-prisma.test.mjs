import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeployTarget } from './preserve-deployed-prisma.mjs';
test('generated-client copy cannot overwrite the source or leave the isolated deployment', () => {
  const source='/workspace/node_modules/.prisma/client', target='/opt/web-runtime/node_modules/.prisma/client', root='/opt/web-runtime';
  assert.doesNotThrow(()=>assertDeployTarget(source,target,root));
  assert.throws(()=>assertDeployTarget(source,source,root));
  assert.throws(()=>assertDeployTarget(source,'/opt/web-runtime-other/node_modules/.prisma/client',root));
  assert.throws(()=>assertDeployTarget(source,'/opt/web-runtime/package.json',root));
  assert.throws(()=>assertDeployTarget(target,target,root));
});
