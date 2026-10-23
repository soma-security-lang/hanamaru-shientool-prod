// Export the existing business/auth implementation without starting an HTTP server.
export { authenticate } from "./auth.js";
export { registerRoutes } from "./routes.js";
export { BackendService } from "./service.js";
export { ApiProblem } from "./errors.js";
export { loadConfig } from "./config.js";
export type { ApiConfig } from "./config.js";
export type { AuthenticatedContext, IdentityTokenVerifier } from "./auth.js";
