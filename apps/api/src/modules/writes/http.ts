import { idempotencyKeySchema, ledgerParamsSchema } from "@ledgerline/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../../config";
import { ApiProblem } from "../../lib/problem";
import { createActor, requireAppOrigin } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import type { WriteIdentity, WriteResult } from "./service";

export async function financialWriteIdentity(
  auth: Auth,
  config: Config,
  request: FastifyRequest,
): Promise<WriteIdentity> {
  const actorId = await createActor(auth)(request);
  requireAppOrigin(request, config.APP_URL);
  const params = ledgerParamsSchema.safeParse(request.params);
  if (!params.success)
    throw new ApiProblem(400, "Invalid request", "Provide a valid ledgerId.", [
      { field: "ledgerId", message: "Use a UUIDv7 ledger ID." },
    ]);
  const key = idempotencyKeySchema.safeParse(
    request.headers["idempotency-key"],
  );
  if (!key.success)
    throw new ApiProblem(
      400,
      "Invalid request",
      "Provide a valid Idempotency-Key.",
      [
        {
          field: "Idempotency-Key",
          message: "Use one valid key for this action and its retries.",
        },
      ],
    );
  return {
    actorId,
    ledgerId: params.data.ledgerId,
    key: key.data,
  };
}

export function sendFinancialWrite(reply: FastifyReply, result: WriteResult) {
  if (result.replayed) reply.header("Idempotency-Replayed", "true");
  return reply
    .code(result.status)
    .send(result.status === 204 ? undefined : result.body);
}
