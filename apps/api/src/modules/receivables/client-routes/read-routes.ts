import {
  clientListQuerySchema,
  contactListSchema,
  contactParamsSchema,
  contactSchema,
  ledgerParamsSchema,
  pageQuerySchema,
  paymentListSchema,
  paymentParamsSchema,
  paymentSchema,
  receivableEventListSchema,
  receivableListQuerySchema,
  receivableListSchema,
  receivableParamsSchema,
  receivableSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createActor, errors } from "../../../lib/route-helpers";
import { getContact, listContacts } from "../../contacts/service";
import {
  contactHistory,
  getPayment,
  getReceivable,
  listPayments,
  listReceivables,
} from "../service";
import type { ClientRouteDeps } from "./deps";

/** The read endpoints: clients, their history, services and payments. */
export function registerClientReadRoutes(
  instance: FastifyInstance,
  { db, auth }: ClientRouteDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts",
    {
      schema: {
        summary: "List clients and exact open balances",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        querystring: clientListQuerySchema,
        response: { 200: contactListSchema, ...errors },
      },
    },
    async (r) => listContacts(db, await actor(r), r.params.ledgerId, r.query),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId",
    {
      schema: {
        summary: "Get a client",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        response: { 200: contactSchema, ...errors },
      },
    },
    async (r) =>
      getContact(db, await actor(r), r.params.ledgerId, r.params.contactId),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/history",
    {
      schema: {
        summary: "Get client history",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: receivableEventListSchema, ...errors },
      },
    },
    async (r) =>
      contactHistory(
        db,
        await actor(r),
        r.params.ledgerId,
        r.params.contactId,
        r.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/receivables",
    {
      schema: {
        summary: "List services",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        querystring: receivableListQuerySchema,
        response: { 200: receivableListSchema, ...errors },
      },
    },
    async (r) =>
      listReceivables(db, await actor(r), r.params.ledgerId, r.query),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId",
    {
      schema: {
        summary: "Get a service",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        response: { 200: receivableSchema, ...errors },
      },
    },
    async (r) =>
      getReceivable(
        db,
        await actor(r),
        r.params.ledgerId,
        r.params.receivableId,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments",
    {
      schema: {
        summary: "List received payments",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: paymentListSchema, ...errors },
      },
    },
    async (r) =>
      listPayments(
        db,
        await actor(r),
        r.params.ledgerId,
        r.params.receivableId,
        r.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments/:paymentId",
    {
      schema: {
        summary: "Get a received payment",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: paymentParamsSchema,
        response: { 200: paymentSchema, ...errors },
      },
    },
    async (r) =>
      getPayment(
        db,
        await actor(r),
        r.params.ledgerId,
        r.params.receivableId,
        r.params.paymentId,
      ),
  );
}
