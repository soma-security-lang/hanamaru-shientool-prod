import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const harness = fileURLToPath(new URL("./src/worker-contract.ts", import.meta.url));
export default defineConfig({
  plugins: [{ name: "prisma-worker-contract", enforce: "pre", resolveId(source, importer) {
    if (source === "@hanamaru/database" && importer?.endsWith(".integration.test.ts")) return harness;
  } }],
  test: { include: ["src/operations.integration.test.ts", "src/processor.integration.test.ts"], fileParallelism: false, maxWorkers: 1 },
});
