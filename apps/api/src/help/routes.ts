import type { FastifyInstance } from "fastify";
import type { BackendService } from "../service.js";
import catalog from "./catalog.json" with { type: "json" };
import {
  visibleArticles,
  answerQuestion,
  parseQuestion,
  questionLease,
  HelpError,
  type HelpActor,
} from "./engine.js";
import { vertexSelector } from "./vertex.js";
export function registerHelpRoutes(
  app: FastifyInstance,
  service: BackendService,
) {
  async function actor(
    auth: Parameters<BackendService["me"]>[0],
  ): Promise<HelpActor> {
    const me = await service.me(auth);
    return {
      id: auth.organizationId + ":" + auth.membershipId,
      roles: auth.roles,
      features: me.featureFlags,
    };
  }
  app.get("/api/v1/help", async (request) => {
    const current = await actor(request.auth);
    return {
      name: catalog.name,
      examples: catalog.examples,
      articles: visibleArticles(catalog, current),
    };
  });
  app.post(
    "/api/v1/help/questions",
    {
      bodyLimit: 32768,
      errorHandler(error, _request, reply) {
        const status = [400, 401, 403, 413, 429].includes(error.statusCode ?? 0) ? error.statusCode! : 503;
        return reply.code(status).send({ error: { code: "HELP_REQUEST", message: status === 413 ? "質問が長すぎます。" : status === 429 ? "少し待ってからお試しください。" : "質問を処理できませんでした。記事検索をご利用ください。" } });
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      let release: (() => void) | undefined;
      try {
        const current = await actor(request.auth);
        release = questionLease(current.id);
        const input = parseQuestion(request.body);
        return await answerQuestion(
          catalog,
          current,
          input,
          vertexSelector,
          process.env.HELP_AI_ENABLED === "true",
        );
      } catch (error) {
        if (error instanceof HelpError)
          return reply
            .code(error.status)
            .send({ error: { code: "HELP_INPUT", message: error.message } });
        return reply
          .code(503)
          .send({
            error: {
              code: "HELP_UNAVAILABLE",
              message: "質問を処理できませんでした。記事検索をご利用ください。",
            },
          });
      } finally {
        release?.();
      }
    },
  );
}
