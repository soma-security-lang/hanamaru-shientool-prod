export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.HANAMARU_PRODUCTION_SESSION === "true") {
    const { productionSessionRuntime } = await import("./server/production-runtime");
    await productionSessionRuntime()!.ready();
  }
}
