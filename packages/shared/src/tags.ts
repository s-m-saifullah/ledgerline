import { z } from "zod";
import { idSchema, ledgerParamsSchema, versionSchema } from "./contracts";

/** Most tags one entry can carry (ADR 0035). */
export const maxTagsPerEntry = 10;

// Commas and semicolons are the separators of the CSV tags column, so names never contain them.
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((name) => !/[,;]/.test(name), "Tag names cannot contain , or ;.")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "Use plain text.");

/** The tags to put on an entry; the same tag twice is a mistake, not a no-op. */
export const tagIdsSchema = z
  .array(idSchema)
  .max(maxTagsPerEntry)
  .refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    "Each tag may appear only once.",
  );

/** What an entry shows of its tags. */
export const tagRefSchema = z.object({
  id: idSchema,
  name: tagNameSchema,
  archived: z.boolean(),
});
export type TagRef = z.infer<typeof tagRefSchema>;

export const tagSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  name: tagNameSchema,
  archivedAt: z.iso.datetime().nullable(),
  // Live entries (not deleted ones) that carry the tag.
  usageCount: z.number().int().min(0),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const tagListSchema = z.object({
  items: z.array(tagSchema),
  nextCursor: idSchema.nullable(),
});
export const tagParamsSchema = ledgerParamsSchema.extend({ tagId: idSchema });
export const tagListQuerySchema = z.object({
  status: z.enum(["all", "active", "archived"]).default("all"),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export const createTagSchema = z.strictObject({ name: tagNameSchema });
export const updateTagSchema = z.strictObject({
  name: tagNameSchema,
  expectedVersion: versionSchema,
});
export const archiveTagSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const unarchiveTagSchema = archiveTagSchema;
export const deleteTagSchema = archiveTagSchema;

export type Tag = z.infer<typeof tagSchema>;
export type CreateTag = z.infer<typeof createTagSchema>;
export type UpdateTag = z.infer<typeof updateTagSchema>;
export type TagListQuery = z.infer<typeof tagListQuerySchema>;
export type ArchiveTag = z.infer<typeof archiveTagSchema>;
