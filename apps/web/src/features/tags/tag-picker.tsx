import { maxTagsPerEntry, tagNameSchema } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api";
import { prepareTagCreate } from "./api";
import { useTags } from "./use-tags";

/**
 * Chips for the chosen tags, a box to find or type one, and your most used tags to tap. Typing a
 * name nobody has yet offers to create it (a new tag is saved at once; the entry keeps it only
 * when the entry itself is saved).
 */
export function TagPicker({
  ledgerId,
  value,
  onChange,
  writable = true,
  id = "tag-picker",
}: {
  ledgerId: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  writable?: boolean;
  id?: string;
}) {
  const client = useQueryClient();
  // Nothing is fetched until a tag is chosen or the box is used, so a plain Add stays light.
  const [touched, setTouched] = useState(false);
  const tags = useTags(ledgerId, touched || value.length > 0);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const all = tags.data ?? [];
  const chosen = value.flatMap(
    (tagId) => all.find((tag) => tag.id === tagId) ?? [],
  );
  const full = value.length >= maxTagsPerEntry;
  const query = text.trim().toLowerCase();
  const suggestions = all
    .filter(
      (tag) =>
        !value.includes(tag.id) &&
        (query ? tag.name.toLowerCase().includes(query) : !tag.archivedAt),
    )
    .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
    .slice(0, 8);
  const exact = all.find((tag) => tag.name.toLowerCase() === query);
  const add = (tagId: string) => {
    onChange([...value, tagId]);
    setText("");
    setError("");
  };
  const create = async () => {
    const parsed = tagNameSchema.safeParse(text);
    if (!parsed.success) {
      setError(
        "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const tag = await prepareTagCreate(ledgerId, parsed.data)();
      await client.invalidateQueries({ queryKey: ["tags", ledgerId] });
      add(tag.id);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "A tag with this name already exists. Pick it from the list."
          : "Couldn't add the tag. Try again.",
      );
      await client.invalidateQueries({ queryKey: ["tags", ledgerId] });
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (full || busy) return;
    if (exact && !value.includes(exact.id)) add(exact.id);
    else if (!exact && query) void create();
    else if (suggestions[0] && query) add(suggestions[0].id);
  };
  return (
    <div className="tag-picker">
      <label htmlFor={`${id}-input`}>Tags</label>
      {chosen.length > 0 && (
        <ul className="tag-chips" aria-label="Chosen tags">
          {chosen.map((tag) => (
            <li key={tag.id} className="tag-chip">
              {tag.name}
              {tag.archivedAt ? " (archived)" : ""}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Remove tag ${tag.name}`}
                disabled={!writable}
                onClick={() =>
                  onChange(value.filter((item) => item !== tag.id))
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {writable && (
        <>
          <input
            id={`${id}-input`}
            value={text}
            maxLength={40}
            autoComplete="off"
            disabled={full || busy}
            onFocus={() => setTouched(true)}
            placeholder={full ? "Ten tags is the most" : "Find or add a tag"}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter picks or creates a tag; it must not save the entry.
                event.preventDefault();
                submit();
              }
            }}
          />
          {!full && (suggestions.length > 0 || (query && !exact)) && (
            <div className="tag-suggestions">
              {suggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="tag-suggestion"
                  disabled={busy}
                  onClick={() => add(tag.id)}
                >
                  {tag.name}
                  {tag.archivedAt ? " (archived)" : ""}
                </button>
              ))}
              {query && !exact && (
                <button
                  type="button"
                  className="tag-suggestion tag-create"
                  disabled={busy}
                  onClick={() => void create()}
                >
                  <Plus size={14} aria-hidden="true" />
                  Create “{text.trim()}”
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
