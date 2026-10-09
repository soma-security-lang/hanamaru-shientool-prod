import { expect, test } from "@playwright/test";
import type { EbaySearchDetailDto } from "@hanamaru/contracts";
import { createLiveSession, installLiveSession, type LiveSession } from "./auth";
import { ebayReadOnlyConfig, readOnlyResultEvidence } from "../src/test/ebay-live-readonly";

const config = ebayReadOnlyConfig(process.env);
test.skip(!config, "Explicit approved eBay live readback inputs are required; skipped is not acceptance");
// The default config retains failure traces; override here to prevent live token/product capture.
test.use({ trace: "off", screenshot: "off", video: "off" });
let session: LiveSession | undefined;
test.beforeAll(async () => {
  if (!config) return;
  const token = process.env.LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN;
  if (!token || !process.env.LIVE_E2E_IDENTITY_PLATFORM_REFRESH_TOKEN || !process.env.LIVE_E2E_IDENTITY_PLATFORM_LOCAL_ID) {
    throw new Error("Approved Identity Platform test identity inputs are required together");
  }
  try { session = await createLiveSession(token); } catch { throw new Error("Approved test identity could not be verified; inspect authentication without printing credentials"); }
  expect(session.me.id === config.membershipId, "The approved dedicated test membership must match").toBe(true);
  expect(session.me.roles.some(role => role === "manager" || role === "assessor"), "Business test role is required").toBe(true);
  expect(session.me.featureFlags.market_price_search && session.me.featureFlags.market_price_ebay, "Approved test scope must have both market flags enabled").toBe(true);
});
test.afterAll(async () => { await session?.api.dispose(); });

test("approved saved eBay result reloads without mutation or additional search", async ({ page, context }) => {
  test.setTimeout(120_000);
  if (!config || !session) throw new Error("Readback session is unavailable");
  await installLiveSession(context, session);
  let attemptedMutations = 0;
  await page.route("**/api/v1/market-price/ebay/**", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { attemptedMutations++; await route.abort(); return; }
    await route.continue();
  });
  const read = async () => {
    const response = await session!.api.get(`market-price/ebay/searches/${config.searchId}`).catch(() => { throw new Error("Saved-result transport failed; do not print request headers"); });
    expect(response.status(), "Approved saved result must be accessible").toBe(200);
    return await response.json().catch(() => { throw new Error("Saved-result response could not be decoded; do not print product content"); }) as EbaySearchDetailDto;
  };
  const initial = await read();
  const before = readOnlyResultEvidence(initial, config.searchId);
  const marketLabels = { us: "米国", uk: "英国", ca: "カナダ", au: "オーストラリア", de: "ドイツ", fr: "フランス", it: "イタリア", es: "スペイン" } as const;
  const verifySavedStatistics = async () => {
    for (const stat of initial.snapshots[0]!.snapshotJson.statistics) {
      const heading = page.getByRole("heading", { name: `${marketLabels[stat.market]}（${stat.currency}）`, exact: true });
      const article = page.getByRole("article").filter({ has: heading });
      const expected = [stat.receivedRows, stat.includedCount, stat.minimum ?? "未算出", stat.median ?? "未算出", stat.maximum ?? "未算出"].map(String);
      // Compare as a boolean so failure output does not contain live prices or product data.
      await expect.poll(async () => {
        const displayed = await article.locator("dl").first().locator("dd").allTextContents();
        return JSON.stringify(displayed.map(value => value.trim())) === JSON.stringify(expected);
      }, { message: "Each market must display the immutable saved counts and native-currency prices" }).toBe(true);
    }
  };
  const url = `/market-price?source=ebay&view=result&searchId=${config.searchId}`;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "保存済みeBay相場結果", exact: true })).toBeVisible();
    await expect(page.getByText(/確定版 \d+・確定日時/)).toBeVisible();
    await expect(page.getByRole("button", { name: "同条件で最新を取得", exact: true })).toBeDisabled();
    await verifySavedStatistics();
    await page.reload();
    await expect(page.getByRole("heading", { name: "保存済みeBay相場結果", exact: true })).toBeVisible();
    await verifySavedStatistics();
    expect(new URL(page.url()).searchParams.get("searchId") === config.searchId, "Reload must keep the same result").toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "No horizontal overflow").toBe(true);
  }
  const after = readOnlyResultEvidence(await read(), config.searchId);
  expect(after === before, "Readback must not change the saved version, pages or credit state").toBe(true);
  expect(attemptedMutations, "Readback cannot perform a new eBay operation").toBe(0);
});
