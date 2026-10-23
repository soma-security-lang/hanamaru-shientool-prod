import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { localPrisma, PrismaRepository } from "@hanamaru/alignment";
import { createLocalProviders } from "@hanamaru/platform";
import { buildWorker } from "./server.js";

/** Separate opt-in localhost entry, never selected by production start. */
export function buildLocalAlignmentWorker() {
  if(process.env.HANAMARU_LOCAL_NATIVE_API!=="true"||process.env.K_SERVICE!==undefined)throw new Error("LOCAL_ALIGNMENT_REQUIRED");
  const url=process.env.ALIGNMENT_DATABASE_URL??"";
  return buildWorker({repository:new PrismaRepository(localPrisma(url),url,"hanamaru_worker","hanamaru_worker_system"),providers:createLocalProviders()});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const app=buildLocalAlignmentWorker();await app.listen({host:"127.0.0.1",port:Number(process.env.WORKER_PORT??3380)});
}
