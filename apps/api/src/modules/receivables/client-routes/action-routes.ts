import {
  contactActionSchema,
  contactParamsSchema,
  contactSchema,
  receivableActionSchema,
  receivableParamsSchema,
  receivableSchema,
  writeOffSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errors, writeHeaders } from "../../../lib/route-helpers";
import { contactAction } from "../../contacts/service";
import { financialWriteIdentity, sendFinancialWrite } from "../../writes/http";
import { receivableAction } from "../service";
import type { ClientRouteDeps } from "./deps";

/** Archive, delete, restore, write off and reopen. */
export function registerClientActionRoutes(
  instance: FastifyInstance,
  { db, config, auth }: ClientRouteDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/archive",
    {
      schema: {
        summary: "archive client",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["Clients"],
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
        summary: "unarchive client",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["Clients"],
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
        summary: "delete client",
        description:
          "Versioned ledger-scoped write with atomic receipt. Received payments are cleared income; linked rows change together. Write-offs waive the remainder without posting money.",
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
        tags: ["Clients"],
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
}
