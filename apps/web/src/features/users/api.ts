import {
  type CreateUser,
  type DeletedUserList,
  deletedUserListSchema,
  type ManagedUser,
  type ManagedUserList,
  managedUserListSchema,
  managedUserSchema,
  type ResetUserPassword,
  type UpdateUser,
} from "@ledgerline/shared";
import { api } from "../../lib/api";

export const usersKey = ["users"] as const;
/** Under `usersKey`, so refreshing the people refreshes the waiting list too. */
export const deletedUsersKey = ["users", "deleted"] as const;

/** The people on this server (admin only): account facts, never anything from a ledger (ADR 0048). */
export async function listUsers(): Promise<ManagedUserList> {
  return managedUserListSchema.parse(await api("/users"));
}

/** Adds a person on a temporary password. The password goes in this one request and is never returned. */
export async function addUser(body: CreateUser): Promise<ManagedUser> {
  return managedUserSchema.parse(
    await api("/users", { method: "POST", body: JSON.stringify(body) }),
  );
}

/** Stops (true) or allows (false) a person's sign-in; their ledger is untouched. */
export async function setUserDisabled(id: string, disabled: boolean) {
  const body: UpdateUser = { disabled };
  await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** Gives a person a new temporary password; they are signed out and must choose their own. */
export async function resetUserPassword(id: string, temporaryPassword: string) {
  const body: ResetUserPassword = { temporaryPassword };
  await api(`/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function signOutUser(id: string) {
  await api(`/users/${id}/sessions`, { method: "DELETE", body: "{}" });
}

export async function turnOffUserTwoFactor(id: string) {
  await api(`/users/${id}/two-factor`, { method: "DELETE", body: "{}" });
}

export async function deleteUser(id: string) {
  await api(`/users/${id}`, { method: "DELETE", body: "{}" });
}

/** The people deleted less than 30 days ago, newest first, with the day they are removed for good (ADR 0049). */
export async function listDeletedUsers(): Promise<DeletedUserList> {
  return deletedUserListSchema.parse(await api("/users/deleted"));
}

/** Brings a deleted person back exactly as they were. */
export async function restoreUser(id: string) {
  await api(`/users/${id}/restore`, { method: "POST", body: "{}" });
}

/** "Delete now": the person and everything of theirs are removed for good. */
export async function purgeUser(id: string) {
  await api(`/users/${id}/purge`, { method: "DELETE", body: "{}" });
}

/** Starts a person's ledger afresh; it can be restored for 30 days. The answer holds a date, never ledger data. */
export async function clearUserLedger(id: string) {
  await api(`/users/${id}/ledger/clear`, { method: "POST", body: "{}" });
}

export async function restoreUserLedger(id: string) {
  await api(`/users/${id}/ledger/restore`, { method: "POST", body: "{}" });
}
