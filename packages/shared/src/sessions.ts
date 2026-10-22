import { z } from "zod";
import { idSchema } from "./contracts";

// The signed-in devices of the caller (ADR 0042). Never carries a token or an address.
export const sessionParamsSchema = z.object({ sessionId: idSchema });
export const sessionItemSchema = z.object({
  id: idSchema,
  // True for the session making this request.
  current: z.boolean(),
  // A readable name from the browser or app that signed in, such as "Chrome on macOS".
  device: z.string(),
  createdAt: z.iso.datetime(),
  // Approximate: a session is touched about once a day while it is in use.
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const sessionListSchema = z.object({
  items: z.array(sessionItemSchema),
});
export type SessionItem = z.infer<typeof sessionItemSchema>;
export type SessionList = z.infer<typeof sessionListSchema>;
