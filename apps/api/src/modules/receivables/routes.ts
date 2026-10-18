import type { FastifyInstance } from "fastify";
import { registerClientActionRoutes } from "./client-routes/action-routes";
import type { ClientRouteDeps } from "./client-routes/deps";
import { registerClientEditRoutes } from "./client-routes/edit-routes";
import { registerClientPaymentRoutes } from "./client-routes/payment-routes";
import { registerClientReadRoutes } from "./client-routes/read-routes";

/** Clients, services and payments. The groups register in a fixed order, which is the order of the OpenAPI document. */
export async function clientRoutes(
  instance: FastifyInstance,
  deps: ClientRouteDeps,
) {
  registerClientReadRoutes(instance, deps);
  registerClientEditRoutes(instance, deps);
  registerClientActionRoutes(instance, deps);
  registerClientPaymentRoutes(instance, deps);
}
