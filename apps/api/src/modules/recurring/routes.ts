import {
  createRecurringRuleSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  problemSchema,
  recurringRuleListSchema,
  recurringRuleParamsSchema,
  recurringRuleSchema,
  recurringRuleVersionSchema,
  recurringRunListSchema,
  recurringRunParamsSchema,
  recurringRunSchema,
  updateRecurringRuleSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { runRecurringRules } from "../../jobs/recurring";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import type { WriteResult } from "../writes/service";
import {
  type Clock,
  createRule,
  deleteRule,
  getRule,
  listRules,
  listRuns,
  pauseRule,
  resumeRule,
  skipRun,
  updateRule,
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
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });
const tags = ["Recurring"];

export async function recurringRoutes(
  instance: FastifyInstance,
  {
    db,
    config,
    auth,
    now,
  }: { db: Database; config: Config; auth: Auth; now: Clock },
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
  /** Entries that are already due appear straight away instead of waiting for the next tick. */
  async function catchUp(
    request: FastifyRequest,
    result: WriteResult,
    ledgerId: string,
    ruleId?: string,
  ) {
    if (result.replayed) return;
    try {
      await runRecurringRules(db, now(), request.log, {
        ledgerId,
        ...(ruleId ? { ruleId } : {}),
      });
    } catch {
      // The hourly tick will try again; the save itself succeeded.
    }
  }
  app.get(
    "/api/v1/ledgers/:ledgerId/recurring-rules",
    {
      schema: {
        summary: "List recurring rules",
        description:
          "Rules that create entries or transfers on a schedule, with the next date still to be created and how many occurrences need attention.",
        tags,
        security,
        params: ledgerParamsSchema,
        response: { 200: recurringRuleListSchema, ...errors },
      },
    },
    async (request) =>
      listRules(db, await actor(request), request.params.ledgerId),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId",
    {
      schema: {
        summary: "Get a recurring rule",
        tags,
        security,
        params: recurringRuleParamsSchema,
        response: { 200: recurringRuleSchema, ...errors },
      },
    },
    async (request) =>
      getRule(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.ruleId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/recurring-rules",
    {
      schema: {
        summary: "Create a recurring rule",
        description:
          "Needs the ledger time zone to be set (409 otherwise). Occurrences from the start date up to today are created right away, at most 100 at a time, and the rest on later runs. A transfer rule can carry an explicit bonus.",
        tags,
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createRecurringRuleSchema,
        response: { 201: recurringRuleSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await createRule(
        db,
        await financialWriteIdentity(auth, config, request),
        request.body,
      );
      await catchUp(
        request,
        result,
        request.params.ledgerId,
        (result.body as { id: string }).id,
      );
      return sendFinancialWrite(reply, result);
    },
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId",
    {
      schema: {
        summary: "Edit a recurring rule",
        description:
          "Changes apply to occurrences not yet created; entries already made are never touched. Changing the schedule starts it again from its start date when nothing has been created yet, otherwise from today.",
        tags,
        security,
        params: recurringRuleParamsSchema,
        headers: writeHeaders,
        body: updateRecurringRuleSchema,
        response: { 200: recurringRuleSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await updateRule(
        db,
        await financialWriteIdentity(auth, config, request),
        request.params.ruleId,
        request.body,
        now,
      );
      await catchUp(
        request,
        result,
        request.params.ledgerId,
        request.params.ruleId,
      );
      return sendFinancialWrite(reply, result);
    },
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId",
    {
      schema: {
        summary: "Delete a recurring rule",
        description: "The entries it already created stay.",
        tags,
        security,
        params: recurringRuleParamsSchema,
        headers: writeHeaders,
        body: recurringRuleVersionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteRule(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.ruleId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId/pause",
    {
      schema: {
        summary: "Pause a recurring rule",
        tags,
        security,
        params: recurringRuleParamsSchema,
        headers: writeHeaders,
        body: recurringRuleVersionSchema,
        response: { 200: recurringRuleSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await pauseRule(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.ruleId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId/resume",
    {
      schema: {
        summary: "Resume a paused recurring rule",
        description:
          "What came due while the rule was paused is skipped, not caught up. The person who resumes it is who the runner acts as from then on.",
        tags,
        security,
        params: recurringRuleParamsSchema,
        headers: writeHeaders,
        body: recurringRuleVersionSchema,
        response: { 200: recurringRuleSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await resumeRule(
        db,
        await financialWriteIdentity(auth, config, request),
        request.params.ruleId,
        request.body,
        now,
      );
      await catchUp(
        request,
        result,
        request.params.ledgerId,
        request.params.ruleId,
      );
      return sendFinancialWrite(reply, result);
    },
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/recurring-rules/:ruleId/runs",
    {
      schema: {
        summary: "List what a rule has done",
        description:
          "The newest 100 occurrences: created (with the entry or transfer it made), skipped, or needing attention with a fixed reason.",
        tags,
        security,
        params: recurringRuleParamsSchema,
        response: { 200: recurringRunListSchema, ...errors },
      },
    },
    async (request) =>
      listRuns(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.ruleId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/recurring-runs/:runId/skip",
    {
      schema: {
        summary: "Skip an occurrence that needs attention",
        description: "It is not tried again and nothing is created for it.",
        tags,
        security,
        params: recurringRunParamsSchema,
        headers: writeHeaders,
        body: recurringRuleVersionSchema,
        response: { 200: recurringRunSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await skipRun(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.runId,
          request.body,
        ),
      ),
  );
}
