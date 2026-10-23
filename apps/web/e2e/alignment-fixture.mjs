// Synthetic loopback-only OIDC issuer. Never imported by the application.
import { createServer } from "node:http";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { loadConfig } from "@hanamaru/api/alignment";
import { buildApp } from "@hanamaru/api/testing";
import { HanamaruRepository, createPool, developmentIds as d } from "@hanamaru/database";
import { createLocalProviders } from "@hanamaru/platform";
import { localPrisma } from "@hanamaru/alignment";
if (process.env.HANAMARU_PERSISTENT_TEST !== "true" || process.env.K_SERVICE !== undefined) throw new Error("TEST_ONLY");
const checked = localPrisma(process.env.ALIGNMENT_DATABASE_URL); await checked.$disconnect();
const issuer = "http://127.0.0.1:3378", web = "http://127.0.0.1:3377";
const secret = process.env.SSO_INTERNAL_SECRET;
if (!secret || secret.length < 32) throw new Error("TEST_SECRET_REQUIRED");
const pool = createPool(process.env.ALIGNMENT_DATABASE_URL);
await pool.query("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='expense_cash_settlement'", [d.organizationId]);
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const codes = new Map(), tokens = new Set();
let revoked = false;
function jwt(payload) {
  const h=Buffer.from(JSON.stringify({alg:"RS256",kid:"local-test",typ:"JWT"})).toString("base64url");
  const b=Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${b}.${sign("RSA-SHA256",Buffer.from(`${h}.${b}`),keys.privateKey).toString("base64url")}`;
}
const server = createServer(async (req, res) => {
  res.setHeader("content-type","application/json");
  const url = new URL(req.url,issuer), path=url.pathname;
  if(path==="/health")return res.end('{}');
  if(path==="/.well-known/openid-configuration")return res.end(JSON.stringify({issuer,authorization_endpoint:`${issuer}/auth`,token_endpoint:`${issuer}/token`,jwks_uri:`${issuer}/jwks`,response_types_supported:["code"],subject_types_supported:["public"],id_token_signing_alg_values_supported:["RS256"],token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"]}));
  if(path==="/jwks")return res.end(JSON.stringify({keys:[{...keys.publicKey.export({format:"jwk"}),kid:"local-test",alg:"RS256",use:"sig"}]}));
  if(path==="/auth") {
    const p=url.searchParams;
    if(p.get("client_id")!=="sso-hanamaru"||p.get("redirect_uri")!==`${web}/api/auth/sso/callback`||p.get("code_challenge_method")!=="S256")return res.writeHead(400).end('{}');
    const code=randomUUID();codes.set(code,{nonce:p.get("nonce"),challenge:p.get("code_challenge"),redirect:p.get("redirect_uri")});
    const target=new URL(p.get("redirect_uri"));target.searchParams.set("code",code);target.searchParams.set("state",p.get("state"));
    return res.writeHead(303,{location:target.toString()}).end();
  }
  const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const form=new URLSearchParams(Buffer.concat(chunks).toString());
  if(path==="/token") {
    const flow=codes.get(form.get("code"));codes.delete(form.get("code"));
    if(!flow||form.get("client_id")!=="sso-hanamaru"||form.get("redirect_uri")!==flow.redirect||createHash("sha256").update(form.get("code_verifier")??"").digest("base64url")!==flow.challenge)return res.writeHead(400).end('{"error":"invalid_grant"}');
    const token=`synthetic-${randomUUID()}`,now=Math.floor(Date.now()/1000);tokens.add(token);
    return res.end(JSON.stringify({access_token:token,token_type:"Bearer",expires_in:300,id_token:jwt({iss:issuer,aud:"sso-hanamaru",sub:"synthetic-immutable-sub",nonce:flow.nonce,auth_time:now,iat:now,exp:now+300})}));
  }
  if(req.headers['x-sso-internal-secret']!==secret)return res.writeHead(403).end('{}');
  if(path==="/test/revoked") {revoked=form.get("value")==="true";return res.end('{}');}
  if(path==="/internal/token")return res.end(JSON.stringify({active:!revoked&&tokens.has(form.get("token")),subject:"synthetic-immutable-sub"}));
  if(path==="/internal/resolve")return res.end(JSON.stringify({links:[{productUserId:d.userId,organizationId:d.organizationId}]}));
  return res.writeHead(404).end('{}');
});
await new Promise(resolve=>server.listen(3378,"127.0.0.1",resolve));
const api=await buildApp({config:loadConfig({...process.env,SSO_ISSUER:issuer,ALLOW_DEV_AUTH:"false"}),repository:new HanamaruRepository(pool,"hanamaru_api","hanamaru_api_system"),providers:createLocalProviders()});
await api.listen({host:"127.0.0.1",port:3379});
async function stop(){await api.close();server.close();}
process.on("SIGTERM",()=>void stop());process.on("SIGINT",()=>void stop());
