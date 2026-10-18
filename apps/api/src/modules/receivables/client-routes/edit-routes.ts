import {
  contactParamsSchema,
  contactSchema,
  createContactSchema,
  createReceivableSchema,
  ledgerParamsSchema,
  receivableParamsSchema,
  receivableSchema,
  updateContactSchema,
  updateReceivableSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { errors, writeHeaders } from "../../../lib/route-helpers";
import { saveContact } from "../../contacts/service";
import { financialWriteIdentity, sendFinancialWrite } from "../../writes/http";
import { saveReceivable } from "../service";
import type { ClientRouteDeps } from "./deps";

/** Create and edit a client or a service. */
export function registerClientEditRoutes(
  instance: FastifyInstance,
  { db, config, auth }: ClientRouteDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts",
    {
      schema: {
        summary: "Create contact",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
}
