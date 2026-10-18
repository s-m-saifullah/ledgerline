import {
  createPaymentSchema,
  paymentActionSchema,
  paymentParamsSchema,
  paymentSchema,
  receivableParamsSchema,
  updatePaymentSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errors, writeHeaders } from "../../../lib/route-helpers";
import { financialWriteIdentity, sendFinancialWrite } from "../../writes/http";
import { mutatePayment } from "../service";
import type { ClientRouteDeps } from "./deps";

/** Record, correct, delete and restore payments. */
export function registerClientPaymentRoutes(
  instance: FastifyInstance,
  { db, config, auth }: ClientRouteDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/v1/ledgers/:ledgerId/receivables/:receivableId/payments",
    {
      schema: {
        summary: "create paired payment and income",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
