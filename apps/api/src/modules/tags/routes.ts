import {
  archiveTagSchema,
  createTagSchema,
  deleteTagSchema,
  ledgerParamsSchema,
  tagListQuerySchema,
  tagListSchema,
  tagParamsSchema,
  tagSchema,
  unarchiveTagSchema,
  updateTagSchema,
} from "@ledgerline/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, errors, writeHeaders } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  archiveTag,
  createTag,
  deleteTag,
  getTag,
  listTags,
  unarchiveTag,
  updateTag,
} from "./service";

const security = [{ sessionCookie: [] }];

export async function tagRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  const identity = (request: FastifyRequest) =>
    financialWriteIdentity(auth, config, request);
  app.get(
    "/api/v1/ledgers/:ledgerId/tags",
    {
      schema: {
        summary: "List tags",
        description:
          "Includes archived tags by default; the status filter is optional. Each tag carries usageCount, the live entries that have it (a transfer counts once). Cursor pagination uses ascending UUIDv7 IDs.",
        tags: ["Tags"],
        security,
        params: ledgerParamsSchema,
        querystring: tagListQuerySchema,
        response: { 200: tagListSchema, ...errors },
      },
    },
    async (request) =>
      listTags(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/tags/:tagId",
    {
      schema: {
        summary: "Get a tag",
        tags: ["Tags"],
        security,
        params: tagParamsSchema,
        response: { 200: tagSchema, ...errors },
      },
    },
    async (request) =>
      getTag(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.tagId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/tags",
    {
      schema: {
        summary: "Create a tag",
        description:
          "Names are 1 to 40 characters without commas or semicolons and are unique ignoring case, archived tags included. Requires owner/editor permission and a trusted Origin.",
        tags: ["Tags"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createTagSchema,
        response: { 201: tagSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createTag(db, await identity(request), request.body),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/tags/:tagId",
    {
      schema: {
        summary: "Rename a tag",
        description:
          "Requires expectedVersion. Entries show the new name at once because they point at the tag.",
        tags: ["Tags"],
        security,
        params: tagParamsSchema,
        headers: writeHeaders,
        body: updateTagSchema,
        response: { 200: tagSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateTag(
          db,
          await identity(request),
          request.params.tagId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/tags/:tagId/archive",
    {
      schema: {
        summary: "Archive a tag",
        description:
          "Hides the tag from pickers. Entries keep it and the entry filter still finds it. Requires expectedVersion.",
        tags: ["Tags"],
        security,
        params: tagParamsSchema,
        headers: writeHeaders,
        body: archiveTagSchema,
        response: { 200: tagSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await archiveTag(
          db,
          await identity(request),
          request.params.tagId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/tags/:tagId/unarchive",
    {
      schema: {
        summary: "Unarchive a tag",
        tags: ["Tags"],
        security,
        params: tagParamsSchema,
        headers: writeHeaders,
        body: unarchiveTagSchema,
        response: { 200: tagSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await unarchiveTag(
          db,
          await identity(request),
          request.params.tagId,
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/tags/:tagId",
    {
      schema: {
        summary: "Delete a tag",
        description:
          "Soft-deletes a tag that no live entry carries; otherwise 409 (archive it instead). Entries already deleted lose the tag for good. Requires expectedVersion. There is no Undo; an unused tag is cheap to create again.",
        tags: ["Tags"],
        security,
        params: tagParamsSchema,
        headers: writeHeaders,
        body: deleteTagSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteTag(
          db,
          await identity(request),
          request.params.tagId,
          request.body,
        ),
      ),
  );
}
