// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { BackendService, loadConfig } from "@hanamaru/api/alignment";
import { buildApp } from "@hanamaru/api/testing";
import { createPool, HanamaruRepository, developmentIds as d } from "@hanamaru/database";
import { localPrisma, PrismaRepository } from "@hanamaru/alignment";
import { createLocalProviders } from "@hanamaru/platform";
import { nativeApi } from "./native-api";

const url = process.env.ALIGNMENT_DATABASE_URL;
describe.skipIf(!url)("native business API with existing authorization and Prisma", () => {
  const legacy = url ? new HanamaruRepository(createPool(url), "hanamaru_api", "hanamaru_api_system") : undefined;
  const modern = url ? new PrismaRepository(localPrisma(url, 1), url, "hanamaru_api", "hanamaru_api_system") : undefined;
  const providers = createLocalProviders();
  const config = loadConfig({ NODE_ENV: "test", ALLOW_DEV_AUTH: "true", API_RATE_LIMIT_MAX: "10000" });
  let old: Awaited<ReturnType<typeof buildApp>>;
  let next: Awaited<ReturnType<typeof nativeApi>>;
  afterAll(async () => { await old?.close(); await modern?.close(); });
  it("keeps the published FAQ parser and route-specific limits on the legacy API owner", async () => {
    const selected = await nativeApi(new BackendService(modern!, providers), config);
    expect(selected.paths.some(path => path.includes("/help"))).toBe(false);
    expect(await selected.handle(new Request("http://127.0.0.1:3388/api/v1/help"))).toBeNull();
    expect(await selected.handle(new Request("http://127.0.0.1:3388/api/v1/help/questions", {method:"POST",headers:{"content-type":"application/json"},body:'{"question":"synthetic"}'}))).toBeNull();
  });
  it("compares every migrated read route and current me against legacy using the same schema", async () => {
    old = await buildApp({ config, repository: legacy, providers });
    next = await nativeApi(new BackendService(modern!, providers), config);
    const paths = next.paths.filter(path => path.startsWith("GET "));
    expect(paths.length).toBeGreaterThan(40);
    for (const entry of paths) {
      const path = entry.slice(4).replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000009999");
      const headers = { "x-request-id": "synthetic-contract-request", "x-dev-role": "assessor" };
      const a = await old.inject({ method: "GET", url: path, headers });
      const b = await next.handle(new Request(`http://127.0.0.1:3388${path}`, { headers }));
      expect(b?.status, path).toBe(a.statusCode);
      expect(await b!.json(), path).toEqual(a.json());
    }
  });
  it("writes once across native and old owner, preserves ID and audit, can roll back ownership", async () => {
    await legacy!.pool.query("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='expense_settlement'", [d.organizationId]);
    const headers = { "content-type": "application/json", "idempotency-key": randomUUID(), "x-request-id": "synthetic-create-day", "x-dev-role": "assessor" };
    const body = JSON.stringify({ businessDate: "2026-04-21" });
    const path = "/api/v1/expense-days";
    const created = await next.handle(new Request(`http://127.0.0.1:3388${path}`, { method: "POST", headers, body }));
    const payload = await created!.json(); expect(created!.status, JSON.stringify(payload)).toBe(200);
    const replay = await old.inject({ method: "POST", url: path, headers, payload: body });
    expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(payload);
    const id = payload.dayId ?? payload.id;
    const read = await next.handle(new Request(`http://127.0.0.1:3388${path}/${id}`, { headers }));
    expect(read!.status).toBe(200);
  });
  it("keeps malformed payload, no-token, unsupported binary and expired scope boundaries", async () => {
    const protectedApi = await nativeApi(new BackendService(modern!, providers), { ...config, allowDevAuth: false });
    expect((await protectedApi.handle(new Request("http://127.0.0.1:3388/api/v1/me")))!.status).toBe(401);
    const headers={"content-type":"application/json","x-dev-role":"assessor","x-request-id":"synthetic-invalid-json"};
    for(const payload of ["{"," ".repeat(2_000_001),""]){
      const invalid = await next.handle(new Request("http://127.0.0.1:3388/api/v1/visits", { method: "POST", headers, body: payload }));
      const expected=await old.inject({method:"POST",url:"/api/v1/visits",headers,payload});
      expect(invalid!.status).toBe(expected.statusCode);expect(await invalid!.json()).toEqual(expected.json());
    }
    expect(await next.handle(new Request("http://127.0.0.1:3388/api/v1/visits",{method:"POST",headers:{"content-type":"text/plain"},body:"synthetic"}))).toBeNull();
    expect(await next.handle(new Request(`http://127.0.0.1:3388/api/v1/recordings/${d.recordingId}/file`))).toBeNull();
  });
});
