import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production native API image contract", () => {
  const docker = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  it("ships the frozen production graph rather than trusting standalone tracing", () => {
    expect(docker).toContain("pnpm install --frozen-lockfile --filter @hanamaru/web...");
    expect(docker).toContain("pnpm --filter @hanamaru/web deploy --prod --legacy /opt/hanamaru/web-runtime");
    expect(docker).toContain("/opt/hanamaru/web-runtime/node_modules ./apps/web/node_modules");
    expect(docker).toContain("USER appuser");
  });
  it("constructs formal GCP providers and resolves all native workspace exports in the final image", () => {
    const runtime = docker.split("AS runtime")[1]!;
    expect(runtime).toContain("PROVIDER_MODE=gcp");
    for (const name of ["@hanamaru/api/alignment", "@hanamaru/alignment", "@hanamaru/platform"])
      expect(runtime).toContain(name);
    expect(runtime).toContain("NATIVE_API_GCP_PRODUCTION_IMPORTS_PASS_NO_EXTERNAL_REQUESTS");
    expect(runtime).not.toContain("PROVIDER_MODE=local");
  });
});
