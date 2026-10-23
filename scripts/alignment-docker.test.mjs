import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root=fileURLToPath(new URL("../",import.meta.url));
const workspaces=new Map();
for(const parent of ["apps","packages"])for(const name of readdirSync(`${root}${parent}`)){
  const dir=`${parent}/${name}`;
  try{const json=JSON.parse(readFileSync(`${root}${dir}/package.json`,"utf8"));workspaces.set(json.name,{dir,json});}catch{/* not a workspace */}
}
function closure(name,seen=new Set()){
  if(seen.has(name))return seen;
  assert.ok(workspaces.has(name),`Missing workspace ${name}`);seen.add(name);
  for(const [dependency,version] of Object.entries(workspaces.get(name).json.dependencies??{}))
    if(String(version).startsWith("workspace:"))closure(dependency,seen);
  return seen;
}
for(const app of ["web","api","worker"])test(`${app} image declares every runtime workspace before frozen install`,()=>{
  const docker=readFileSync(`${root}apps/${app}/Dockerfile`,"utf8");
  const before=docker.slice(0,docker.indexOf("RUN pnpm install"));
  for(const dependency of closure(`@hanamaru/${app}`)){
    const {dir}=workspaces.get(dependency);
    assert.ok(before.includes(`COPY ${dir}/package.json ${dir}/package.json`),`${app}: missing ${dependency} manifest`);
    assert.ok(docker.includes(`COPY ${dir} ${dir}`)||(dir.startsWith("packages/")&&docker.includes("COPY packages packages")),`${app}: missing ${dependency} source`);
  }
  assert.ok(docker.includes(`pnpm -r --filter @hanamaru/${app}... --if-present build`),`${app}: build must follow the selected dependency graph`);
  const runtime=docker.slice(docker.indexOf("AS runtime"));
  assert.ok(!/HANAMARU_(?:LOCAL_|BFF_ENABLED|SERVER_SSO)/.test(runtime),"Local migration must not be enabled by runtime image defaults");
});
