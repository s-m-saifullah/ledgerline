import type { Tag } from "@ledgerline/shared";
import { ListCard } from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import {
  prepareTagArchive,
  prepareTagCreate,
  prepareTagDelete,
  prepareTagRename,
} from "./api";
import { parseTagName, tagNameMessage } from "./model";

const failure = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/**
 * One sheet for a tag (ADR 0047, the prototype's `OV["tag-form"]`): a new tag asks for its name; an existing tag
 * opens on its actions (view its entries, rename, archive or unarchive, delete), and Rename swaps the content
 * inside the same sheet so it never slides in twice. Delete asks in a centred question over the sheet. Each write
 * keeps its Idempotency-Key until the answer is known, so a lost answer is repeated, never doubled.
 */
export function TagSheet({
  ledgerId,
  tag,
  onDismiss,
  onSaved,
}: {
  ledgerId: string;
  /** Absent for a new tag. */
  tag?: Tag | undefined;
  onDismiss: () => void;
  /** Called with the sentence that says what happened, once the write is confirmed. */
  onSaved: (notice: string) => void;
}) {
  const [renaming, setRenaming] = useState(!tag);
  const [name, setName] = useState(tag?.name ?? "");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const nameBox = useRef<HTMLInputElement | null>(null);
  // Rename swaps the content of the open sheet, so the button that was pressed is gone: the name takes focus.
  useEffect(() => {
    if (renaming) nameBox.current?.focus();
  }, [renaming]);
  const send = async (
    sig: string,
    prepare: () => () => Promise<unknown>,
    done: string,
    fallback: string,
  ) => {
    if (attempt.current?.sig !== sig) attempt.current = { sig, run: prepare() };
    setBusy(true);
    setError("");
    try {
      await attempt.current.run();
    } catch (problem) {
      // A refusal is final; anything else may have gone through, so the same key is used again.
      if (problem instanceof ApiError && problem.status < 500)
        attempt.current = null;
      setError(
        problem instanceof ApiError && problem.status >= 500
          ? "We couldn't confirm that. Please try again."
          : failure(problem, fallback),
      );
      return;
    } finally {
      setBusy(false);
    }
    onSaved(done);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseTagName(name);
    if (!parsed) {
      setError(tagNameMessage);
      return;
    }
    if (tag)
      void send(
        `rename|${parsed}`,
        () => prepareTagRename(ledgerId, tag, parsed),
        `Renamed to ${parsed}.`,
        "Couldn't rename the tag.",
      );
    else
      void send(
        `add|${parsed}`,
        () => prepareTagCreate(ledgerId, parsed),
        `Added the tag ${parsed}.`,
        "Couldn't add the tag.",
      );
  };
  const archive = () => {
    if (!tag) return;
    const archiving = !tag.archivedAt;
    void send(
      archiving ? "archive" : "unarchive",
      () => prepareTagArchive(ledgerId, tag, archiving),
      archiving
        ? `Archived ${tag.name}. It stays on its entries.`
        : `Unarchived ${tag.name}.`,
      "Couldn't change the tag.",
    );
  };
  const remove = () => {
    if (!tag) return;
    void send(
      "delete",
      () => prepareTagDelete(ledgerId, tag),
      `Deleted the tag ${tag.name}.`,
      "Couldn't delete the tag.",
    );
  };
  const used = tag?.usageCount ?? 0;
  const returnFocusId = tag ? `tag-${tag.id}` : "add-tag";
  return (
    <>
      <Overlay
        open
        title={renaming ? (tag ? "Rename tag" : "Add tag") : (tag?.name ?? "")}
        description={
          renaming
            ? "Entries show the new name straight away."
            : "What you can do with this tag."
        }
        busy={busy}
        onDismiss={onDismiss}
        returnFocusId={returnFocusId}
        fallbackFocusId="tags-title"
        initialFocusId={renaming ? "tag-name" : undefined}
        footer={
          renaming ? (
            <button
              type="submit"
              form="tag-form"
              className="ui-btn ui-btn-primary"
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          ) : undefined
        }
      >
        {renaming ? (
          <form id="tag-form" className="tg-form" noValidate onSubmit={submit}>
            <div className="tg-field">
              <label htmlFor="tag-name">Name</label>
              <input
                id="tag-name"
                ref={nameBox}
                value={name}
                maxLength={40}
                autoComplete="off"
                placeholder="Name"
                disabled={busy}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? "tag-error" : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
              />
            </div>
            {error && (
              <p id="tag-error" role="alert" className="field-error">
                {error}
              </p>
            )}
          </form>
        ) : (
          <div className="tg-form">
            <ListCard>
              <Link
                to="/transactions"
                search={{ tagId: tag?.id }}
                className="ui-row ui-row-press tg-row"
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">View entries</span>
                </span>
              </Link>
              <button
                type="button"
                className="ui-row ui-row-press tg-row"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setRenaming(true);
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">Rename</span>
                </span>
              </button>
              <button
                type="button"
                className="ui-row ui-row-press tg-row"
                disabled={busy}
                onClick={archive}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">
                    {tag?.archivedAt ? "Unarchive" : "Archive"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="ui-row ui-row-press tg-row"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setAsking(true);
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title tg-danger">Delete</span>
                </span>
              </button>
            </ListCard>
            {error && !asking && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Overlay>
      {tag && (
        <Overlay
          kind="question"
          open={asking}
          title={`Delete ${tag.name}?`}
          busy={busy}
          onDismiss={() => {
            setAsking(false);
            setError("");
          }}
          returnFocusId={`tag-${tag.id}`}
          fallbackFocusId="tags-title"
          footer={
            <button
              type="button"
              className="ui-btn ui-btn-danger-filled"
              disabled={busy || used > 0}
              onClick={remove}
            >
              {busy ? "Deleting…" : "Delete tag"}
            </button>
          }
        >
          <p>
            {used > 0
              ? `${used === 1 ? "1 entry has" : `${used} entries have`} this tag, so it can't be deleted. Archive it to hide it instead.`
              : "No entry has it. This can't be undone, but you can add the tag again any time."}
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </Overlay>
      )}
    </>
  );
}
