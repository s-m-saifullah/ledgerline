import { z } from "zod";
import { idSchema } from "./contracts";

// The signed-in person and their own account (ADR 0048). Never carries a password, a hash or a token.
export const meSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
  // The account the server was set up with; the only one that sees the Users page.
  isAdmin: z.boolean(),
  // True while the person is still on a temporary password: every other request is refused until it is changed.
  mustChangePassword: z.boolean(),
  twoFactorEnabled: z.boolean(),
});
export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  // The sign-in rule: 12 to 128 characters.
  newPassword: z.string().min(12).max(128),
  // Also signs out the Android app, which uses the same sign-in.
  signOutOtherDevices: z.boolean().default(true),
});
/** The `type` of the 403 problem a person on a temporary password gets for everything but changing it. */
export const passwordChangeRequiredType =
  "urn:ledgerline:problem:password-change-required";
export type Me = z.infer<typeof meSchema>;
export type UpdateMe = z.infer<typeof updateMeSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
