import { type Tag, tagNameSchema } from "@ledgerline/shared";

export const tagNameMessage =
  "Use 1 to 40 characters, without commas or semicolons, for a tag name.";

/** The name a person typed, ready to send, or null when it breaks the rule (the rule is the API's own). */
export const parseTagName = (text: string) => {
  const parsed = tagNameSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
};

/** The one hint of a row: how many entries carry the tag. */
export const tagHint = (tag: Pick<Tag, "usageCount">) =>
  tag.usageCount === 1 ? "1 entry" : `${tag.usageCount} entries`;

/** The tags by name, the active ones and the archived ones apart, both narrowed by part of a name. */
export function splitTags(items: readonly Tag[], query: string) {
  const needle = query.trim().toLowerCase();
  const shown = items
    .filter((tag) => tag.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    active: shown.filter((tag) => !tag.archivedAt),
    archived: shown.filter((tag) => tag.archivedAt),
  };
}
