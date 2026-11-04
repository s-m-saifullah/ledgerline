import { z } from "zod";
import { idSchema } from "./contracts";

// The people the admin manages (ADR 0048). Account facts only: never a password, a hash, a token or anything from a ledger.
export const userParamsSchema = z.object({ userId: idSchema });
export const managedUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
  // The account the server was set up with. One only.
  isAdmin: z.boolean(),
  // True until the person has chosen their own password.
  mustChangePassword: z.boolean(),
  // True while their sign-in is stopped (their ledger is untouched).
  disabled: z.boolean(),
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const managedUserListSchema = z.object({
  items: z.array(managedUserSchema),
});
// A person in "Recently deleted" (ADR 0049): account facts and when they are removed for good (30 days after the
// delete). Never anything from their ledger.
export const deletedUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
  deletedAt: z.iso.datetime(),
  purgeAt: z.iso.datetime(),
});
export const deletedUserListSchema = z.object({
  items: z.array(deletedUserSchema),
});
// The sign-in rule: 12 to 128 characters. Sent once, never returned and never logged.
const temporaryPasswordSchema = z.string().min(12).max(128);
export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  temporaryPassword: temporaryPasswordSchema,
});
export const updateUserSchema = z.object({ disabled: z.boolean() });
export const resetUserPasswordSchema = z.object({
  temporaryPassword: temporaryPasswordSchema,
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type ManagedUserList = z.infer<typeof managedUserListSchema>;
export type DeletedUser = z.infer<typeof deletedUserSchema>;
export type DeletedUserList = z.infer<typeof deletedUserListSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type ResetUserPassword = z.infer<typeof resetUserPasswordSchema>;
