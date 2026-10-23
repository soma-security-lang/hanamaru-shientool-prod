import { BackendService, loadConfig } from "@hanamaru/api/alignment";
import { createLocalProviders } from "@hanamaru/platform/runtime";
import { localPrisma, PrismaRepository } from "@hanamaru/alignment";
import { nativeApi } from "./native-api";

let runtime: ReturnType<typeof nativeApi> | undefined;
/** Explicit local-only writer selection. Errors never rerun a write on legacy. */
export const localApiFetch: typeof fetch = async (input, init) => {
  if (process.env.HANAMARU_LOCAL_NATIVE_API !== "true") return fetch(input, init);
  if (process.env.K_SERVICE !== undefined || process.env.HANAMARU_BFF_LOCAL !== "true" ||
      process.env.HANAMARU_LOCAL_SESSION_POC !== "true") throw new Error("LOCAL_NATIVE_API_REQUIRED");
  const request = input instanceof Request && !init ? input : new Request(input, init);
  const upstream = new URL(process.env.HANAMARU_BFF_UPSTREAM ?? "");
  if (new URL(request.url).origin !== upstream.origin || upstream.hostname !== "127.0.0.1") throw new Error("LOCAL_UPSTREAM_REQUIRED");
  runtime ??= (async () => {
    const url = process.env.ALIGNMENT_DATABASE_URL ?? "";
    const repository = new PrismaRepository(localPrisma(url), url, "hanamaru_api", "hanamaru_api_system");
    const config = loadConfig({ ...process.env, ALLOW_DEV_AUTH: "false" });
    // No external provider requests are made by the local migration runtime.
    return nativeApi(new BackendService(repository, createLocalProviders()), config);
  })();
  return await (await runtime).handle(request) ?? fetch(input, init);
};
