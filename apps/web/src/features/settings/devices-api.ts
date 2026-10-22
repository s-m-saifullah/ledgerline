import { type SessionList, sessionListSchema } from "@ledgerline/shared";
import { api } from "../../lib/api";

export const devicesKey = ["sessions"] as const;

/** The devices signed in as the caller (ADR 0042). */
export async function getDevices(): Promise<SessionList> {
  return sessionListSchema.parse(await api("/sessions"));
}

/** Signs one other device out. */
export async function signOutDevice(id: string) {
  await api(`/sessions/${id}`, { method: "DELETE", body: "{}" });
}

/** Signs every other device out. */
export async function signOutOtherDevices() {
  await api("/sessions", { method: "DELETE", body: "{}" });
}
