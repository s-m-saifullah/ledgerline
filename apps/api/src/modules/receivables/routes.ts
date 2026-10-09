import {
  contactActionSchema,
  contactListSchema,
  contactParamsSchema,
  contactSchema,
  createContactSchema,
  createPaymentSchema,
  createReceivableSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  pageQuerySchema,
  paymentActionSchema,
  paymentListSchema,
  paymentParamsSchema,
  paymentSchema,
  peopleListQuerySchema,
  problemSchema,
  receivableActionSchema,
  receivableEventListSchema,
  receivableListQuerySchema,
  receivableListSchema,
  receivableParamsSchema,
  receivableSchema,
  updateContactSchema,
  updatePaymentSchema,
  updateReceivableSchema,
  writeOffSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import {
  contactAction,
  getContact,
  listContacts,
  saveContact,
} from "../contacts/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  contactHistory,
  getPayment,
  getReceivable,
  listPayments,
  listReceivables,
  mutatePayment,
  receivableAction,
  saveReceivable,
} from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });
export async function peopleRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  async function actor(request: FastifyRequest) {
    const s = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!s) throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return s.user.id;
  }
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts",
    {
      schema: {
        summary: "List people and exact open balances",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        querystring: peopleListQuerySchema,
        response: { 200: contactListSchema, ...errors },
      },
    },
    async (r) => listContacts(db, await actor(r), r.params.ledgerId, r.query),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId",
    {
      schema: {
        summary: "Get a person",
        tags: ["People"],
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
        summary: "Get person history",
        tags: ["People"],
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
        tags: ["People"],
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
        tags: ["People"],
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
        tags: ["People"],
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
        tags: ["People"],
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
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts",
    {
      schema: {
        summary: "Create contact",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createContactSchema,
        response: { 201: contactSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await saveContact(
          db,
          await financialWriteIdentity(auth, config, r),
          null,
          r.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId",
    {
      schema: {
        summary: "Edit contact",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        headers: writeHeaders,
        body: updateContactSchema,
        response: { 200: contactSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await saveContact(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables",
    {
      schema: {
        summary: "Create receivable",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createReceivableSchema,
        response: { 201: receivableSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await saveReceivable(
          db,
          await financialWriteIdentity(auth, config, r),
          null,
          r.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId",
    {
      schema: {
        summary: "Edit receivable",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: updateReceivableSchema,
        response: { 200: receivableSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await saveReceivable(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/archive",
    {
      schema: {
        summary: "archive person",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        headers: writeHeaders,
        body: contactActionSchema,
        response: { 200: contactSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await contactAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.body.expectedVersion,
          "archive",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/unarchive",
    {
      schema: {
        summary: "unarchive person",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        headers: writeHeaders,
        body: contactActionSchema,
        response: { 200: contactSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await contactAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.body.expectedVersion,
          "unarchive",
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId",
    {
      schema: {
        summary: "delete person",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: contactParamsSchema,
        headers: writeHeaders,
        body: contactActionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await contactAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.body.expectedVersion,
          "delete",
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId",
    {
      schema: {
        summary: "delete service",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: receivableActionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await receivableAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.body,
          "delete",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/restore",
    {
      schema: {
        summary: "restore service",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: receivableActionSchema,
        response: { 200: receivableSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await receivableAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.body,
          "restore",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/write-off",
    {
      schema: {
        summary: "write-off service",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: writeOffSchema,
        response: { 200: receivableSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await receivableAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.body,
          "write-off",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/reopen",
    {
      schema: {
        summary: "reopen service",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: receivableActionSchema,
        response: { 200: receivableSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await receivableAction(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.body,
          "reopen",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments",
    {
      schema: {
        summary: "create paired payment and income",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: receivableParamsSchema,
        headers: writeHeaders,
        body: createPaymentSchema,
        response: { 201: paymentSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await mutatePayment(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          null,
          r.body,
          "create",
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments/:paymentId",
    {
      schema: {
        summary: "edit paired payment and income",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: paymentParamsSchema,
        headers: writeHeaders,
        body: updatePaymentSchema,
        response: { 200: paymentSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await mutatePayment(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.params.paymentId,
          r.body,
          "edit",
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments/:paymentId",
    {
      schema: {
        summary: "delete paired payment and income",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: paymentParamsSchema,
        headers: writeHeaders,
        body: paymentActionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await mutatePayment(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.params.paymentId,
          r.body,
          "delete",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments/:paymentId/restore",
    {
      schema: {
        summary: "restore paired payment and income",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["People"],
        security: [{ sessionCookie: [] }],
        params: paymentParamsSchema,
        headers: writeHeaders,
        body: paymentActionSchema,
        response: { 200: paymentSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await mutatePayment(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receivableId,
          r.params.paymentId,
          r.body,
          "restore",
        ),
      ),
  );
}
