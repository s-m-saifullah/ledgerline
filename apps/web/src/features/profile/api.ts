import {
  type ChangePassword,
  type Me,
  meSchema,
  type UpdateMe,
} from "@ledgerline/shared";
import { api } from "../../lib/api";

export const meKey = ["me"] as const;

/** Who I am (ADR 0048): name, email, whether I am the admin, whether two-factor is on. */
export async function getMe(): Promise<Me> {
  return meSchema.parse(await api("/me"));
}

/** Changes my name; the email and the admin flag cannot be changed here. */
export async function renameMe(name: string): Promise<Me> {
  const body: UpdateMe = { name };
  return meSchema.parse(
    await api("/me", { method: "PATCH", body: JSON.stringify(body) }),
  );
}

/** Changes my password. Needs the current one; with `signOutOtherDevices` my other devices are signed out. */
export async function changePassword(body: ChangePassword) {
  await api("/me/password", { method: "POST", body: JSON.stringify(body) });
}
