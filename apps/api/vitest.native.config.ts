import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const harness=fileURLToPath(new URL("../web/src/server/native-contract-harness.ts",import.meta.url));
export default defineConfig({
  plugins:[{name:"native-business-contract-test",enforce:"pre",resolveId(source,importer){
    if(source==="./app.js"&&importer?.endsWith(".integration.test.ts"))return harness;
  }}],
  test:{include:["src/**/*.integration.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:30000},
});
