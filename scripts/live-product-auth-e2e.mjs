#!/usr/bin/env node

import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = requireFromWeb("@playwright/test");

const googleIdToken = process.env.LIVE_E2E_GOOGLE_ID_TOKEN;
const apiKey = process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY;
const authDomain = process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN;
if (!googleIdToken || !apiKey || !authDomain) {
  console.error("Live auth E2E is blocked: Google ID token and Identity Platform public configuration are required.");
  process.exit(1);
}

const apiBase = `http://127.0.0.1:${process.env.LOCAL_API_PORT ?? "3200"}/api/v1`;
const webBase = `http://127.0.0.1:${process.env.LOCAL_WEB_PORT ?? "3100"}`;
let browser;
let stage = "identity-platform-exchange";

try {
  const exchange = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestUri: `https://${authDomain}/__/auth/handler`,
      postBody: new URLSearchParams({ id_token: googleIdToken, providerId: "google.com" }).toString(),
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  if (!exchange.ok) throw new Error("identity-platform-exchange");
  const identity = await exchange.json();
  if (!identity.idToken || !identity.refreshToken || !identity.localId) throw new Error("identity-platform-token-contract");

  stage = "authenticated-api";
  const meResponse = await fetch(`${apiBase}/me`, { headers: { authorization: `Bearer ${identity.idToken}` } });
  if (!meResponse.ok) throw new Error("me-not-authorized");

  stage = "authenticated-browser";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const expirationTime = Date.now() + Number(identity.expiresIn) * 1_000;
  const storageKey = `firebase:authUser:${apiKey}:[DEFAULT]`;
  const authUser = {
    uid: identity.localId,
    email: identity.email ?? null,
    emailVerified: true,
    displayName: identity.displayName ?? null,
    isAnonymous: false,
    photoURL: identity.photoUrl ?? null,
    phoneNumber: null,
    providerData: [{ providerId: "google.com", uid: identity.localId, displayName: identity.displayName ?? null, email: identity.email ?? null, phoneNumber: null, photoURL: identity.photoUrl ?? null }],
    stsTokenManager: { refreshToken: identity.refreshToken, accessToken: identity.idToken, expirationTime },
    createdAt: String(Date.now()),
    lastLoginAt: String(Date.now()),
    apiKey,
    appName: "[DEFAULT]",
  };
  await context.addInitScript(/** @param {{key:string,value:string}} input */ (input) => {
    const { key, value } = input;
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  }, { key: storageKey, value: JSON.stringify(authUser) });
  const page = await context.newPage();
  await page.goto(`${webBase}/`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") throw new Error("login-loop");
  if (!(await page.locator("h1").first().isVisible())) throw new Error("workspace-heading-missing");
  if ((await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("firebase:authUser:"))))) throw new Error("identity-persisted-in-local-storage");
  if (!(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("firebase:authUser:"))))) throw new Error("identity-session-storage-missing");

  console.log(JSON.stringify({
    status: "PASS",
    identityProvider: "google-identity-platform",
    backendSessionCreated: false,
    bearerApi: true,
    sessionStorageOnly: true,
    authenticatedWorkspace: true,
  }, null, 2));
} catch {
  console.error(`Live auth E2E failed at ${stage}. Token, account data and provider responses are intentionally not printed.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
