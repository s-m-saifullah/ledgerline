import { type ChangePassword, type Me, meSchema } from "@ledgerline/shared";
import { api } from "./api";

/** Who I am (ADR 0048): name, email, whether I am the admin, whether two-factor is on. */
export async function getMe(): Promise<Me> {
  return meSchema.parse(await api("/me"));
}

/** Changes my password. Needs the current one; with `signOutOtherDevices` my other devices are signed out. */
export async function changePassword(body: ChangePassword) {
  await api("/me/password", { method: "POST", body: JSON.stringify(body) });
}
