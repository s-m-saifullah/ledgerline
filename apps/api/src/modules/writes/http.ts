import { idempotencyKeySchema, ledgerParamsSchema } from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../../config";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import type { WriteIdentity, WriteResult } from "./service";

export async function financialWriteIdentity(
  auth: Auth,
  config: Config,
  request: FastifyRequest,
): Promise<WriteIdentity> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session)
    throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
  if (request.headers.origin !== new URL(config.APP_URL).origin)
    throw new ApiProblem(403, "Forbidden", "Request origin is not allowed.");
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
    actorId: session.user.id,
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
