import {
  archiveCategorySchema,
  categoryBatchSchema,
  categoryListQuerySchema,
  categoryListSchema,
  categoryMergePreviewQuerySchema,
  categoryMergePreviewSchema,
  categoryMergeResultSchema,
  categoryMergeSchema,
  categoryParamsSchema,
  categorySchema,
  createCategorySchema,
  createCategoryStarterSetSchema,
  deleteCategorySchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  problemSchema,
  reorderCategoriesSchema,
  unarchiveCategorySchema,
  updateCategorySchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import { mergeCategories, previewCategoryMerge } from "./merge-service";
import {
  archiveCategory,
  createCategory,
  createCategoryStarterSet,
  deleteCategory,
  getCategory,
  listCategories,
  reorderCategories,
  unarchiveCategory,
  updateCategory,
} from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const security = [{ sessionCookie: [] }];
// Preserve cookies/origin while validating and documenting the write key.
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });

export async function categoryRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  async function actor(request: FastifyRequest) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return session.user.id;
  }
  app.get(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId/merge-preview",
    {
      schema: {
        summary: "Preview a category merge",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        querystring: categoryMergePreviewQuerySchema,
        response: { 200: categoryMergePreviewSchema, ...errors },
      },
    },
    async (request) =>
      previewCategoryMerge(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.categoryId,
        request.query.destinationCategoryId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId/merge",
    {
      schema: {
        summary: "Atomically merge categories",
        tags: ["Categories"],
        security,
        description:
          "Requires owner/editor, trusted Origin, Idempotency-Key, expected category versions and an unchanged server preview. Moves live financial references and children, archives the source and preserves all money. Deleted history is unchanged; this operation has no bulk Undo.",
        params: categoryParamsSchema,
        headers: writeHeaders,
        body: categoryMergeSchema,
        response: { 200: categoryMergeResultSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await mergeCategories(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.categoryId,
          request.body,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/categories",
    {
      schema: {
        summary: "List categories",
        description:
          "Includes archives by default; status and kind filters are optional. Cursor pagination uses ascending UUIDv7 IDs. After loading pages, display siblings by sortOrder then ID.",
        tags: ["Categories"],
        security,
        params: ledgerParamsSchema,
        querystring: categoryListQuerySchema,
        response: { 200: categoryListSchema, ...errors },
      },
    },
    async (request) =>
      listCategories(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId",
    {
      schema: {
        summary: "Get a category",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        response: { 200: categorySchema, ...errors },
      },
    },
    async (request) =>
      getCategory(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.categoryId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories",
    {
      schema: {
        summary: "Create a category",
        description:
          "Creates an income/expense category under an active root of the same kind. Sibling names are case-insensitively unique, including archives. Requires owner/editor permission and a trusted Origin.",
        tags: ["Categories"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createCategorySchema,
        response: { 201: categorySchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createCategory(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId",
    {
      schema: {
        summary: "Edit a category",
        description:
          "Requires expectedVersion. Kind is immutable. Parent changes must preserve two levels. Editing an archive preserves its archive state and historical identity.",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        headers: writeHeaders,
        body: updateCategorySchema,
        response: { 200: categorySchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateCategory(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.categoryId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId/archive",
    {
      schema: {
        summary: "Archive a category",
        description:
          "Retains labels and hierarchy for historical reads. Archive active children first. Requires expectedVersion. Reusing the same key replays the original result; a new action on an already archived category conflicts.",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        headers: writeHeaders,
        body: archiveCategorySchema,
        response: { 200: categorySchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await archiveCategory(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.categoryId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId/unarchive",
    {
      schema: {
        summary: "Unarchive a category",
        description:
          "Restores the same label and identity, appending to its sibling group. Restore an archived parent before its children; children are never restored automatically. Requires expectedVersion. The same key replays the original result; a new action on an active category conflicts.",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        headers: writeHeaders,
        body: unarchiveCategorySchema,
        response: { 200: categorySchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await unarchiveCategory(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.categoryId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories/reorder",
    {
      schema: {
        summary: "Reorder active sibling categories",
        description:
          "Provide the complete active sibling group with each expectedVersion, in desired order. The transaction advances all versions and commits all positions together; incomplete or stale groups conflict.",
        tags: ["Categories"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: reorderCategoriesSchema,
        response: { 200: categoryBatchSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await reorderCategories(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/categories/starter-set",
    {
      schema: {
        summary: "Explicitly create a starter category set",
        description:
          "Requires starterSet=basic (seven root categories) or starterSet=default (about forty neutral categories in two levels; optional groups lists the groups to include, default all default groups; optional add-on groups such as students, shared-household or gig-costs are created only when named). starterSet=personal is the original name of the default set and behaves identically. Requires an empty category list, including archives. Creates categories only, never accounts, atomically. Never runs automatically; retries replay the original response.",
        tags: ["Categories"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createCategoryStarterSetSchema,
        response: { 201: categoryBatchSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createCategoryStarterSet(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/categories/:categoryId",
    {
      schema: {
        summary: "Delete a category",
        description:
          "Soft-deletes an active or archived category only after all connected cleared/pending transactions are deleted. Children must be deleted or moved first, including archived children. Requires expectedVersion. Deleted transactions retain this reference ID; their Undo fails while the category is deleted. Same-key retries replay 204.",
        tags: ["Categories"],
        security,
        params: categoryParamsSchema,
        headers: writeHeaders,
        body: deleteCategorySchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteCategory(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.categoryId,
          request.body,
        ),
      ),
  );
}
