// Runs the real Soumu OIDC provider against a separate synthetic local DB.
// Test controls never enter application/runtime code or a deployed image entrypoint.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { loadConfig } from "@hanamaru/api/alignment";
import { buildApp } from "@hanamaru/api/testing";
import { createPool, HanamaruRepository, developmentIds as d } from "@hanamaru/database";
import { createLocalProviders } from "@hanamaru/platform";
import { localPrisma, PrismaSessionStore } from "@hanamaru/alignment";

if (process.env.HANAMARU_REAL_SSO_TEST !== "true" || process.env.K_SERVICE !== undefined) throw new Error("LOCAL_TEST_ONLY");
const source = process.env.SOUMU_LOCAL_REPO;
const soumuUrl = new URL(process.env.SOUMU_ALIGNMENT_DATABASE_URL ?? "");
if (!source || soumuUrl.hostname !== "127.0.0.1" || soumuUrl.pathname !== "/soumu_alignment_test" || soumuUrl.search || soumuUrl.hash) throw new Error("ISOLATED_SSO_DATABASE_REQUIRED");
const requireSso = createRequire(join(source, "apps/sso/package.json"));
const { Pool } = requireSso("pg"), argon2 = requireSso("argon2");
const soumu = new Pool({ connectionString: soumuUrl.toString(), max: 2 });
const product = createPool(process.env.ALIGNMENT_DATABASE_URL);
const prisma = localPrisma(process.env.ALIGNMENT_DATABASE_URL);
const store = new PrismaSessionStore(prisma, process.env.ALIGNMENT_SESSION_KEY);
const issuer = "http://127.0.0.1:3381", web = "http://127.0.0.1:3383";
const subject = "c1111111-1111-4111-8111-111111111111", user = "c2222222-2222-4222-8222-222222222222", operator = "c3333333-3333-4333-8333-333333333333";
const password = process.env.SYNTHETIC_SSO_PASSWORD, secret = process.env.SSO_INTERNAL_SECRET;
if (!password || !secret || secret.length < 32) throw new Error("SYNTHETIC_TEST_SECRETS_REQUIRED");
await soumu.query(`INSERT INTO app_users(id,employee_code,email,display_name,app_role,source_kind) VALUES
  ($1,'LONG-SYNTHETIC','long-session@example.invalid','合成確認社員','現場','independent'),
  ($2,'LONG-OPERATOR','long-operator@example.invalid','合成承認者','管理者','independent')`, [user, operator]);
await soumu.query("INSERT INTO local_credentials(user_id,login_id,password_hash,must_change) VALUES($1,'long.synthetic',$2,false)", [user, await argon2.hash(password, { type: argon2.argon2id })]);
const bootstrapUrl = new URL(soumuUrl); bootstrapUrl.username = "sso_bootstrap"; bootstrapUrl.password = "";
const bootstrap = new Pool({ connectionString: bootstrapUrl.toString() });
await bootstrap.query("SELECT sso.provision_subject($1,$2,$3,$4)", [subject, user, operator, "APPROVED-SYNTHETIC-LONG-SESSION"]);
await bootstrap.query("SELECT sso.approve_product_link($1,'hanamaru',$2,$3,$4,$5)", [subject, d.userId, d.organizationId, operator, "APPROVED-SYNTHETIC-LONG-HANAMARU"]);
await bootstrap.end();
await product.query("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='expense_cash_settlement'", [d.organizationId]);
const clients = ["soumu", "kintai", "hanamaru"].map((code, index) => ({
  client_id: `sso-${code}`, ...(code === "hanamaru" ? {} : { client_secret: randomBytes(32).toString("hex") }),
  redirect_uris: [code === "hanamaru" ? `${web}/api/auth/sso/callback` : `http://127.0.0.1:${3384 + index}/api/auth/sso/callback`],
  response_types: ["code"], grant_types: code === "hanamaru" ? ["authorization_code", "refresh_token"] : ["authorization_code"],
  token_endpoint_auth_method: code === "hanamaru" ? "none" : "client_secret_basic",
}));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const authUrl = new URL(soumuUrl); authUrl.username = "sso_auth"; authUrl.password = "";
const child = spawn("pnpm", ["--filter", "@soumu/sso", "exec", "tsx", "src/server.ts"], { cwd: source, detached: true,
  env: { ...process.env, PORT: "3381", SSO_BIND_HOST: "127.0.0.1", SSO_ISSUER: issuer, SSO_DATABASE_URL: authUrl.toString(), SSO_LOCAL_LONG_SESSION: "true",
    SSO_CLIENTS_JSON: JSON.stringify(clients), SSO_PRODUCTS_JSON: JSON.stringify(clients.map(client => ({ code: client.client_id.slice(4), label: client.client_id.slice(4), startUrl: `${new URL(client.redirect_uris[0]).origin}/login` }))),
    SSO_COOKIE_KEY: randomBytes(32).toString("hex"), SSO_JWKS_JSON: JSON.stringify({ keys: [{ ...privateKey.export({ format: "jwk" }), kid: "local-real-provider", alg: "RS256", use: "sig" }] }),
    SSO_INTERNAL_SECRETS_JSON: JSON.stringify({ soumu: randomBytes(32).toString("hex"), kintai: randomBytes(32).toString("hex"), hanamaru: secret }),
    // Do not inherit a remote management endpoint from the caller.
    SSO_ADMIN_URL: "", SSO_ADMIN_API_KEY: "" }, stdio: "ignore" });
let api, control, stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
  await api?.close(); control?.close(); await Promise.all([soumu.end(), product.end(), prisma.$disconnect()]);
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${issuer}/healthz/ready`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("REAL_LOCAL_PROVIDER_NOT_READY");
  api = await buildApp({ config: loadConfig({ ...process.env, SSO_ISSUER: issuer, ALLOW_DEV_AUTH: "false" }), repository: new HanamaruRepository(createPool(process.env.ALIGNMENT_DATABASE_URL), "hanamaru_api", "hanamaru_api_system"), providers: createLocalProviders() });
  await api.listen({ host: "127.0.0.1", port: 3382 });
  control = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") return res.end("{}");
    if (req.method !== "POST" || req.headers["x-local-test-secret"] !== secret) return res.writeHead(403).end("{}");
    try {
      const chunks = []; for await (const chunk of req) { chunks.push(Buffer.from(chunk)); if (Buffer.concat(chunks).length > 1024) throw new Error("TOO_LARGE"); }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (input.action === "reset") {
        await soumu.query("DELETE FROM sso.logout_epochs WHERE subject=$1", [subject]);
        await soumu.query("UPDATE sso.product_links SET status='active' WHERE subject=$1 AND product_code='hanamaru'", [subject]);
      } else if (input.action === "unlink") {
        await soumu.query("UPDATE sso.product_links SET status='revoked' WHERE subject=$1 AND product_code='hanamaru'", [subject]);
      } else if (["expire-access", "expire-session"].includes(input.action)) {
        if (!/^[a-f0-9]{64}$/.test(input.key ?? "")) throw new Error("INVALID_SESSION_KEY");
        const row = await store.get(input.key); if (!row?.value.sso) throw new Error("SESSION_NOT_FOUND");
        const next = structuredClone(row.value);
        if (input.action === "expire-session") next.expiresAt = Date.now() - 1;
        else {
          next.sso.accessExpiresAt = Date.now() - 1;
          await soumu.query("UPDATE sso.oidc_objects SET expires_at=now()-interval '1 second' WHERE model='AccessToken' AND payload->>'accountId'=$1", [subject]);
        }
        if (!await store.replace(input.key, row.version, input.key, next)) throw new Error("SESSION_CHANGED");
      } else if (input.action !== "stats") throw new Error("UNKNOWN_ACTION");
      const stats = await soumu.query("SELECT count(*)::int total,count(*) FILTER(WHERE payload ? 'consumed')::int consumed FROM sso.oidc_objects WHERE model='RefreshToken' AND payload->>'accountId'=$1", [subject]);
      return res.end(JSON.stringify(stats.rows[0]));
    } catch (error) {
      const code = ["INVALID_SESSION_KEY", "SESSION_NOT_FOUND", "SESSION_CHANGED", "UNKNOWN_ACTION"].includes(error?.message) ? error.message : "LOCAL_TEST_CONTROL_FAILED";
      return res.writeHead(400).end(JSON.stringify({ error: code }));
    }
  });
  await new Promise(resolve => control.listen(3386, "127.0.0.1", resolve));
} catch (error) { await stop(); throw error; }
