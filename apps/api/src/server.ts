import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
const config=loadConfig(); const app=await buildApp({config});
const stop=async(signal:string)=>{app.log.info({signal},"shutting down");await app.close();process.exit(0);};
process.on("SIGTERM",()=>void stop("SIGTERM"));process.on("SIGINT",()=>void stop("SIGINT"));
await app.listen({host:config.host,port:config.port});
