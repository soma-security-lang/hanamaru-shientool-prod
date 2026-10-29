import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Keep the original baseline. P3-P6 reviewed seam changes are pinned explicitly;
// native API/Prisma integration tests complement (not replace) this guard.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "09d6fb1432e85a8bebd5342df078c2baba18e6ad";
const git = args => execFileSync("git", args, { cwd: root });
const prefixes = ["apps/api/", "apps/worker/", "packages/contracts/", "packages/database/", "packages/market-price/", "packages/platform/", "infra/", "firebase.json", ".firebaserc"];
const paths = git(["ls-tree", "-r", "--name-only", "-z", base]).toString().split("\0").filter(path => path && prefixes.some(prefix => path === prefix || path.startsWith(prefix)));
const hash = data => createHash("sha256").update(data).digest("hex");
const reviewed = {
  "apps/api/Dockerfile": "a956ffbbb57348de95a3fb2824716c4831a4ac6cc69d85a543f2dbab48f30ebd",
  "apps/api/package.json": "3f4d933dd4594bffc615d3d2c3cc1cc4d1c99ddfd3dda65cd9644fc40c72c684",
  "apps/api/src/service.ts": "b8ef80efea9b36fb10e4ebbdd1132c578c94de9f2ba0437bc82c9475743a1af0",
  "apps/api/tsconfig.build.json": "b9151f7d6bf734aaf2853ff056bbe18d9bd3cfc6ee31123b1f2ab0144e426304",
  "apps/worker/package.json": "52fc06f11393805f761953d3f29754ff6b138cc71af9b201cefa06372fe9cb6a",
  "apps/worker/Dockerfile": "b7fff340dffba153a27496e31c37869bc44e620bb7e2e29cba62beb0a54a1f60",
  "apps/worker/src/server.ts": "71dcc088ca788f21eb75f0f8fbddcde05090088c03bd99369e18e21893e5bd7f",
  "packages/platform/package.json": "40616be5e1ab9446c3df18d537bd26d217525658205fa9087063613e159529bc",
  "packages/platform/src/index.ts": "1e3a29bb91f7848ff2518b0697b8cf53ad5ee4a3dc2b3c521b593874e69005e4",
};
const additions = {
  // Additive session-only schema, reviewed with dedicated-role rejection tests.
  "packages/database/migrations/0071_runtime_sessions.sql": "872cb691ac44b4e31591a4028d954c47b8a172ee67fe1a714b44a0cdd9d80d03",
  "apps/api/src/alignment.ts": "35678c496bf73b5b2a6600ab309a4e6ca6b696f9d14cb428dd66e9e7becafb64",
  "apps/api/vitest.native.config.ts": "ec167ce13967f90ac002c2ec8acfdc1751060b3f1b29523269bb8892c759b230",
  "apps/worker/src/alignment-local.ts": "0d82ebef5eac2ad89b3ea714d256e0ed5b38dc44b8348b3e965051a9a26df359",
  "apps/worker/src/alignment.integration.test.ts": "5a6b23dbb8872080cc38206c5fe7f910bbe98ea3df9b0c90b9f99650695b22f7",
  "packages/platform/src/cipher.ts": "a113c59a25980eb306d4a56d69dd6734d6c4343974859dad5c61adb89488b434",
  "packages/platform/src/runtime.ts": "70ae78256e6ef0410cd6a52cbb28ddfdb89632ccd91f5efc1dafd2fe2017a61d",
};
const changed = paths.filter(path => !existsSync(`${root}${path}`) || hash(readFileSync(`${root}${path}`)) !== hash(git(["show", `${base}:${path}`])));
const unexpected = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(path => path && prefixes.some(prefix => path === prefix || path.startsWith(prefix)));
const groups = Object.fromEntries(prefixes.map(prefix => [prefix, paths.filter(path => path === prefix || path.startsWith(prefix)).length]));
const unreviewed = changed.filter(path => reviewed[path] !== hash(readFileSync(`${root}${path}`)));
const newUnexpected = unexpected.filter(path => additions[path] !== hash(readFileSync(`${root}${path}`)));
const missing = Object.keys(additions).filter(path => !existsSync(`${root}${path}`));
const oldCipher = git(["show", `${base}:packages/platform/src/index.ts`]).toString().split("\n").find(line => line.startsWith("export function createTokenCipher"));
const cipherUnchanged = readFileSync(`${root}packages/platform/src/cipher.ts`, "utf8").includes(oldCipher);
console.log(JSON.stringify({ baseline: base, checkedFiles: paths.length, unchangedFiles: paths.length-changed.length,
  groups, reviewedChanges: changed, reviewedAdditions: unexpected, unreviewed, newUnexpected, missing, cipherUnchanged }, null, 2));
if (unreviewed.length || newUnexpected.length || missing.length || !cipherUnchanged) process.exitCode = 1;
