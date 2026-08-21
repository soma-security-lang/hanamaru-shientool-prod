#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** @param {string} name */
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
/** @param {Response} response @param {string} stage */
const json = async (response, stage) => {
  if (!response.ok) throw new Error(`${stage} failed (${response.status})`);
  return response.json();
};
/** @param {string} value */
const base64url = (value) => Buffer.from(value).toString("base64url");

const projectId = required("GCP_PROJECT_ID");
const accessToken = required("GCLOUD_ACCESS_TOKEN");
const apiKey = required("IDENTITY_PLATFORM_API_KEY");
const email = required("E2E_EMAIL").toLowerCase();
const serviceAccount = required("E2E_SIGNING_SERVICE_ACCOUNT");
const outputPath = resolve(required("E2E_IDENTITY_OUTPUT"));
const authDomain = required("IDENTITY_PLATFORM_AUTH_DOMAIN");
const headers = {
  authorization: `Bearer ${accessToken}`,
  "content-type": "application/json",
  "x-goog-user-project": projectId,
};

try {
  const lookup = await json(
    await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: [email] }),
    }),
    "identity lookup",
  );
  const account = lookup.users?.[0];
  if (!account?.localId || account.email?.toLowerCase() !== email || account.emailVerified !== true)
    throw new Error("verified Identity Platform account was not found");

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: serviceAccount,
      sub: serviceAccount,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid: account.localId,
    }),
  )}`;
  const signed = await json(
    await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signBlob`,
      { method: "POST", headers, body: JSON.stringify({ payload: Buffer.from(unsigned).toString("base64") }) },
    ),
    "custom token signing",
  );
  if (!signed.signedBlob) throw new Error("custom token signature was not returned");
  const customToken = `${unsigned}.${Buffer.from(signed.signedBlob, "base64").toString("base64url")}`;
  const identity = await json(
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://${authDomain}/` },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }),
    "custom token exchange",
  );
  const payload = JSON.parse(Buffer.from(identity.idToken.split(".")[1], "base64url").toString("utf8"));
  if (payload.email?.toLowerCase() !== email || payload.email_verified !== true || payload.aud !== projectId)
    throw new Error("issued Identity Platform token does not match the requested account");

  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(
    outputPath,
    JSON.stringify({
      idToken: identity.idToken,
      refreshToken: identity.refreshToken,
      localId: identity.localId,
      expiresIn: identity.expiresIn,
    }),
    { mode: 0o600 },
  );
  await chmod(outputPath, 0o600);
  console.log(JSON.stringify({ status: "PASS", identityProvider: "identity-platform", outputMode: "0600-file" }));
} catch (error) {
  console.error(`Live E2E identity mint failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
