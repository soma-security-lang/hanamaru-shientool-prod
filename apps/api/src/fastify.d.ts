import type {AuthenticatedContext} from "./auth.js";
declare module "fastify" {
  interface FastifyRequest { auth:AuthenticatedContext }
  interface FastifyContextConfig { public?:boolean }
}
