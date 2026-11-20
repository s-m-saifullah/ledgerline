import { type Me, meSchema, type UpdateMe } from "@ledgerline/shared";
import { api } from "../../lib/api";

/** Changes my name; the email and the admin flag cannot be changed here. */
export async function renameMe(name: string): Promise<Me> {
  const body: UpdateMe = { name };
  return meSchema.parse(
    await api("/me", { method: "PATCH", body: JSON.stringify(body) }),
  );
}
