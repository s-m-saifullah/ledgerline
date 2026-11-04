import {
  type CreateUser,
  type ManagedUser,
  type ManagedUserList,
  managedUserListSchema,
  managedUserSchema,
  type ResetUserPassword,
  type UpdateUser,
} from "@ledgerline/shared";
import { api } from "../../lib/api";

export const usersKey = ["users"] as const;

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
