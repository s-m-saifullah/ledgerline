import {
  createUserSchema,
  deletedUserListSchema,
  managedUserListSchema,
  managedUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
  userParamsSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { errors, requireAppOrigin } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { listDeletedUsers, purgeNow, restoreUser } from "./lifecycle";
import {
  clearPersonLedger,
  createUser,
  deleteUser,
  listUsers,
  requireAdmin,
  resetPassword,
  restorePersonLedger,
  setDisabled,
  signOutEverywhere,
  turnOffTwoFactor,
} from "./service";

const security = [{ sessionCookie: [] }, { bearerAuth: [] }];
const adminOnly =
  " Admin only (`403` for anyone else); the admin's own account is `409`. Needs `Origin` like every write. Takes no `Idempotency-Key` (ADR 0048). Never returns a password, a hash, a token or anything from a ledger.";

/**
 * The admin's routes for the people on this server (ADR 0048). They are about accounts, not a ledger, so they take
 * no Idempotency-Key and never read a ledger's rows.
 */
export async function userRoutes(
  instance: FastifyInstance,
  { db, auth, config }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const admin = async (request: FastifyRequest, write = false) => {
    const found = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!found)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    await requireAdmin(db, found.user.id);
    if (write) requireAppOrigin(request, config.APP_URL);
    return found.user.id;
  };
  app.get(
    "/api/v1/users",
    {
      schema: {
        summary: "List the people on this server",
        description:
          "Admin only (`403` for anyone else). Name, email, whether they are the admin, whether they are on a temporary password, whether their sign-in is stopped, whether two-factor is on, and when they were added; oldest first. Deleted people are not listed. Never returns a password, a hash, a token or anything from a ledger.",
        tags: ["Users"],
        security,
        response: { 200: managedUserListSchema, ...errors },
      },
    },
    async (request) => {
      await admin(request);
      return { items: await listUsers(db) };
    },
  );
  app.get(
    "/api/v1/users/deleted",
    {
      schema: {
        summary: "List the people in Recently deleted",
        description:
          "Admin only (`403` for anyone else). People deleted in the last 30 days, newest first, with when they were deleted and when they are removed for good (30 days later); each can be restored until then (ADR 0049). Account facts only: never a password, a hash, a token or anything from a ledger.",
        tags: ["Users"],
        security,
        response: { 200: deletedUserListSchema, ...errors },
      },
    },
    async (request) => {
      await admin(request);
      return { items: await listDeletedUsers(db) };
    },
  );
  app.post(
    "/api/v1/users",
    {
      schema: {
        summary: "Add a person",
        description: `Makes a person with their own account and their own ledger, on the temporary password in the request (12 to 128 characters, sent once, stored hashed, never returned or logged). They must choose their own at first sign-in. An email that exists, in any letter case, deleted people included, is \`409\`. Unknown fields are ignored: a person is never made an admin here.${adminOnly}`,
        tags: ["Users"],
        security,
        body: createUserSchema,
        response: { 201: managedUserSchema, ...errors },
      },
    },
    async (request, reply) => {
      await admin(request, true);
      return reply.code(201).send(await createUser(db, request.body));
    },
  );
  app.patch(
    "/api/v1/users/:userId",
    {
      schema: {
        summary: "Stop or allow a person's sign-in",
        description: `\`disabled: true\` ends their sessions and app tokens and refuses their sign-in; their ledger is untouched. \`false\` allows it again. Safe to repeat.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        body: updateUserSchema,
        response: { 200: managedUserSchema, ...errors },
      },
    },
    async (request) => {
      const adminId = await admin(request, true);
      return setDisabled(
        db,
        adminId,
        request.params.userId,
        request.body.disabled,
      );
    },
  );
  app.post(
    "/api/v1/users/:userId/password",
    {
      schema: {
        summary: "Give a person a new temporary password",
        description: `Replaces their password with the one in the request (12 to 128 characters, sent once, never returned or logged), makes them choose their own at the next sign-in and ends their sessions.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        body: resetUserPasswordSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const adminId = await admin(request, true);
      await resetPassword(
        db,
        adminId,
        request.params.userId,
        request.body.temporaryPassword,
      );
      return reply.code(204).send(null);
    },
  );
  app.delete(
    "/api/v1/users/:userId/sessions",
    {
      schema: {
        summary: "Sign a person out everywhere",
        description: `Ends all their sessions and app tokens. They can sign in again. Safe to repeat.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const adminId = await admin(request, true);
      await signOutEverywhere(db, adminId, request.params.userId);
      return reply.code(204).send(null);
    },
  );
  app.delete(
    "/api/v1/users/:userId/two-factor",
    {
      schema: {
        summary: "Turn off a person's two-factor",
        description: `For a person who lost their phone: removes their authenticator secret and backup codes and ends their sessions. Safe to repeat.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const adminId = await admin(request, true);
      await turnOffTwoFactor(db, adminId, request.params.userId);
      return reply.code(204).send(null);
    },
  );
  app.delete(
    "/api/v1/users/:userId",
    {
      schema: {
        summary: "Delete a person",
        description: `Soft-deletes the person, their sign-in, their ledger and memberships, and ends their sessions. Old backups still hold the data. Their email stays taken. A person who is already deleted is \`404\`.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const adminId = await admin(request, true);
      await deleteUser(db, adminId, request.params.userId);
      return reply.code(204).send(null);
    },
  );
  app.post(
    "/api/v1/users/:userId/restore",
    {
      schema: {
        summary: "Restore a deleted person",
        description: `Brings back a person deleted less than 30 days ago exactly as they were: their account, ledger and everything in it, with the same password, two-factor and stopped or allowed sign-in. Their sessions stay ended, so they sign in again. A person who is not in Recently deleted, or whose 30 days are over, is \`404\`.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 200: managedUserSchema, ...errors },
      },
    },
    async (request) => {
      const adminId = await admin(request, true);
      return restoreUser(db, adminId, request.params.userId);
    },
  );
  app.post(
    "/api/v1/users/:userId/ledger/clear",
    {
      schema: {
        summary: "Clear a person's ledger",
        description: `Empties the person's ledger so they can start fresh: every entry, account, category and the rest is removed from sight, and can be restored for 30 days (one undo; clearing again removes the older one at once). The ledger, its name, its currency and the person's access stay. Does nothing, and keeps any undo, when the ledger is already empty. Answers with the person and the date of the clear, never anything from the ledger.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 200: managedUserSchema, ...errors },
      },
    },
    async (request) => {
      const adminId = await admin(request, true);
      return clearPersonLedger(db, adminId, request.params.userId);
    },
  );
  app.post(
    "/api/v1/users/:userId/ledger/restore",
    {
      schema: {
        summary: "Restore a person's cleared ledger",
        description: `Brings back what the last clear removed, for 30 days after it and only while the ledger has nothing live in it (\`409\`, "Clear what is there now first."). Nothing to restore, or the 30 days over, is \`409\`. Answers with the person, never anything from the ledger.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 200: managedUserSchema, ...errors },
      },
    },
    async (request) => {
      const adminId = await admin(request, true);
      return restorePersonLedger(db, adminId, request.params.userId);
    },
  );
  app.delete(
    "/api/v1/users/:userId/purge",
    {
      schema: {
        summary: "Delete a deleted person for good, now",
        description: `Removes a person who is in Recently deleted, their ledger and everything in it, for good and at once; their email can be used again. Cannot be undone, but older backups still hold the data until they age out (seven days on the server, 90 days off-site). A person who is not in Recently deleted is \`404\`.${adminOnly}`,
        tags: ["Users"],
        security,
        params: userParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const adminId = await admin(request, true);
      await purgeNow(db, adminId, request.params.userId);
      return reply.code(204).send(null);
    },
  );
}
