import { describe,expect,it } from "vitest";
import { cloudRunAudience } from "./gcp.js";

describe("Cloud Tasks worker URL contract",()=>{
  it("uses the Cloud Run service origin as the OIDC audience",()=>{
    expect(cloudRunAudience("https://hanamaru-worker-abc-an.a.run.app/internal/tasks")).toBe("https://hanamaru-worker-abc-an.a.run.app");
  });

  it.each([
    "http://hanamaru-worker.example/internal/tasks",
    "https://hanamaru-worker.example/internal/tasks/extra",
    "https://hanamaru-worker.example/internal/tasks?unsafe=1",
  ])("rejects an invalid worker task URL: %s",workerUrl=>{
    expect(()=>cloudRunAudience(workerUrl)).toThrow("WORKER_TASK_URL");
  });
});
