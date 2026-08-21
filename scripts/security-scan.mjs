import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {extname} from "node:path";

const files=execFileSync("git",["ls-files","-co","--exclude-standard","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const textExtensions=new Set([".css",".example",".js",".json",".md",".mjs",".sql",".sh",".tf",".ts",".tsx",".yaml",".yml"]);
const excluded=["pnpm-lock.yaml","poc-content.json","/.terraform/","/.artifacts/","/test-results/","/playwright-report/"];
const secretPatterns=[
  ["private key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Google API key",/AIza[0-9A-Za-z_-]{35}/],
  ["AWS access key",/AKIA[0-9A-Z]{16}/],
  ["GitHub token",/(?:ghp|github_pat)_[0-9A-Za-z_]{20,}/],
  ["Slack token",/xox[baprs]-[0-9A-Za-z-]{20,}/],
  ["service account private key",/"private_key"\s*:\s*"-----BEGIN/],
];
const allowedEmailDomains=new Set(["example.invalid","example.com"]);
const findings=[];
let scanned=0;

for(const file of files){
  const normalized=`/${file}`;
  if(excluded.some(value=>normalized.includes(value))||!textExtensions.has(extname(file)))continue;
  let body;
  try{body=readFileSync(file,"utf8");}catch{continue;}
  scanned+=1;
  for(const [label,pattern] of secretPatterns)if(pattern.test(body))findings.push(`${file}: ${label}`);
  for(const match of body.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)){
    const domain=match[1].toLowerCase();
    if(!allowedEmailDomains.has(domain)&&!domain.endsWith(".gserviceaccount.com"))findings.push(`${file}: non-anonymous email domain ${domain}`);
  }
}

if(findings.length){
  console.error(`security scan failed (${findings.length})`);
  for(const finding of findings)console.error(`- ${finding}`);
  process.exit(1);
}
console.log(JSON.stringify({scanned,secretFindings:0,nonAnonymousEmailFindings:0}));
