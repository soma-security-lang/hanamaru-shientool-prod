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
  "apps/api/Dockerfile": "a8f70ffb20479affd379d4581ba0b02e7a3302e57535f448eaf05261120e634e",
  "apps/api/package.json": "9c09e58c93ff61c4bdd7c634f1f4488970958903bfce3a8486aec981647f1b71",
  "apps/api/src/routes.ts": "56b7167ad842552fb041f2a6884b6c6adefcf3e7f370c09845883a9ace6b8e01",
  "apps/api/src/service.ts": "b8ef80efea9b36fb10e4ebbdd1132c578c94de9f2ba0437bc82c9475743a1af0",
  "apps/api/tsconfig.build.json": "b9151f7d6bf734aaf2853ff056bbe18d9bd3cfc6ee31123b1f2ab0144e426304",
  "apps/worker/package.json": "52fc06f11393805f761953d3f29754ff6b138cc71af9b201cefa06372fe9cb6a",
  "apps/worker/Dockerfile": "b7fff340dffba153a27496e31c37869bc44e620bb7e2e29cba62beb0a54a1f60",
  "apps/worker/src/server.ts": "71dcc088ca788f21eb75f0f8fbddcde05090088c03bd99369e18e21893e5bd7f",
  "packages/platform/package.json": "ba4d8b9dcaa42aa1afbeb5f50e47471a3785d98b25c463490c7667bf30b69e21",
  "packages/platform/src/index.ts": "1e3a29bb91f7848ff2518b0697b8cf53ad5ee4a3dc2b3c521b593874e69005e4",
};
const additions = {
  // Published API FAQ (5af6b6c) is retained, rather than reverting the live API.
  "apps/api/src/help/catalog.json": "7c0db08ab410d69c0f06bea421824dbd15930ec6c63988498962de148c1795e2",
  "apps/api/src/help/engine.test.ts": "29c165f6b6ca5d81ac9d8a5c74bdcf7038e28796e6551062813fd3071c3c302b",
  "apps/api/src/help/engine.ts": "786db531b38250f0f8340eadad4f923bbf76c933bbf392be09456e07d767c076",
  "apps/api/src/help/routes.test.ts": "c5d7171cdda3dabfe8b697b592892de10b43f47fa5178ab28f08ef03ba671c35",
  "apps/api/src/help/routes.ts": "76441c59adfb90546262662f99a5070071a8d5d9c49404935642467f88f3ba63",
  "apps/api/src/help/vertex.ts": "b6ebbd40c4e3b7f1fa3e026d8c28665e87fa9517653c1eeaaac58595f360e847",
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
const unexpected = [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0"))]
  .filter(path => path && !paths.includes(path) && prefixes.some(prefix => path === prefix || path.startsWith(prefix)));
const groups = Object.fromEntries(prefixes.map(prefix => [prefix, paths.filter(path => path === prefix || path.startsWith(prefix)).length]));
const unreviewed = changed.filter(path => reviewed[path] !== hash(readFileSync(`${root}${path}`)));
const newUnexpected = unexpected.filter(path => additions[path] !== hash(readFileSync(`${root}${path}`)));
const missing = Object.keys(additions).filter(path => !existsSync(`${root}${path}`));
const oldCipher = git(["show", `${base}:packages/platform/src/index.ts`]).toString().split("\n").find(line => line.startsWith("export function createTokenCipher"));
const cipherUnchanged = readFileSync(`${root}packages/platform/src/cipher.ts`, "utf8").includes(oldCipher);
console.log(JSON.stringify({ baseline: base, checkedFiles: paths.length, unchangedFiles: paths.length-changed.length,
  groups, reviewedChanges: changed, reviewedAdditions: unexpected, unreviewed, newUnexpected, missing, cipherUnchanged }, null, 2));
if (unreviewed.length || newUnexpected.length || missing.length || !cipherUnchanged) process.exitCode = 1;
