import type { TagRef } from "@ledgerline/shared";

/** Small neutral labels under an entry (never red; archived tags are only dimmed). Spans, because rows are buttons. */
export function TagChips({ tags }: { tags: readonly TagRef[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tag-chips">
      <span className="sr-only">Tags: </span>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={tag.archived ? "tag-chip muted" : "tag-chip"}
        >
          {tag.name}
        </span>
      ))}
    </span>
  );
}
