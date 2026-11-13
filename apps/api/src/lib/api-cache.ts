import type { FastifyInstance } from "fastify";

/**
 * Nothing the API answers may be kept by a browser or a proxy: it is a person's money. A route that sets its own
 * Cache-Control keeps it; every other /api response, errors and refusals included, gets no-store.
 */
export function addApiNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/") && !reply.hasHeader("cache-control"))
      reply.header("cache-control", "no-store");
    return payload;
  });
}
