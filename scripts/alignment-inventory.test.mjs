import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { extractApi, inventory } from "./alignment-inventory.mjs";

test("API inventory includes generic and nongeneric registrations, not comments", () => {
  const file = ts.createSourceFile("fixture.ts", `
    // app.get('/not-a-route', () => {});
    app.get<{Params:{id:string}}>('/api/v1/items/:id', async r => service.get(r.auth));
    app.post('/api/v1/items', async r => expense.create(r.auth));
  `, ts.ScriptTarget.Latest, true);
  assert.deepEqual(extractApi(file).map(({ method, path, handlers }) => ({ method, path, handlers })), [
    { method: "GET", path: "/api/v1/items/:id", handlers: ["service.get"] },
    { method: "POST", path: "/api/v1/items", handlers: ["expense.create"] },
  ]);
});
test("unresolved dynamic registration fails instead of disappearing", () => {
  const file = ts.createSourceFile("fixture.ts", "app.get(dynamicPath, handler)", ts.ScriptTarget.Latest, true);
  assert.throws(() => extractApi(file), /Nonliteral API/);
});
test("inventory includes expenses, ranking, ebay and worker without executing application", () => {
  const data = inventory();
  for (const id of ["SCR-021", "SCR-022", "SCR-023", "SCR-024"]) assert.ok(data.screens.some(e => e.id === id));
  for (const route of ["/api/v1/expense-days", "/api/v1/purchase-performance", "/api/v1/market-price/ebay/searches"])
    assert.ok(data.api.some(e => e.path === route));
  assert.ok(data.workerJobs.some(e => e.type === "market_price_ebay_search"));
  assert.ok(data.migrations.some(e => e.file.endsWith("0070_branch_address.sql")));
});
