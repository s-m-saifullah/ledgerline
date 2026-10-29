import { type Tag, tagNameSchema } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, List, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError, getLedgers } from "../../lib/api";
import {
  prepareTagArchive,
  prepareTagCreate,
  prepareTagDelete,
  prepareTagRename,
} from "./api";
import { useTags } from "./use-tags";

type Dialog =
  | { kind: "rename"; tag: Tag }
  | { kind: "delete"; tag: Tag }
  | null;
const message = (failure: unknown, fallback: string) =>
  failure instanceof ApiError ? failure.message : fallback;

export function TagsPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <p role="status">Opening your tags…</p>;
  if (ledgers.isError || !ledger)
    return (
      <section className="settings-card">
        <h1>Tags</h1>
        <p role="alert">Couldn't load your ledger.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void ledgers.refetch()}
        >
          Try again
        </button>
      </section>
    );
  return (
    <LedgerTags
      key={ledger.id}
      ledgerId={ledger.id}
      writable={ledger.role !== "viewer"}
    />
  );
}
function LedgerTags({
  ledgerId,
  writable,
}: {
  ledgerId: string;
  writable: boolean;
}) {
  const client = useQueryClient();
  const tags = useTags(ledgerId);
  const [newName, setNewName] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [renameText, setRenameText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["tags", ledgerId] });
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      return true;
    } catch (failure) {
      setError(message(failure, fallback));
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const items = (tags.data ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const active = items.filter((tag) => !tag.archivedAt);
  const archived = items.filter((tag) => tag.archivedAt);
  const create = async () => {
    const parsed = tagNameSchema.safeParse(newName);
    if (!parsed.success) {
      setError(
        "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
      );
      return;
    }
    if (
      await run(
        () => prepareTagCreate(ledgerId, parsed.data)(),
        "Couldn't add the tag.",
      )
    ) {
      setNewName("");
      setNotice(`Added the tag ${parsed.data}.`);
    }
  };
  const row = (tag: Tag) => (
    <li key={tag.id} className="tag-row">
      <div className="tag-row-name">
        <strong>{tag.name}</strong>
        <span className="muted">
          {tag.usageCount === 1 ? "1 entry" : `${tag.usageCount} entries`}
        </span>
      </div>
      <div className="tag-row-actions">
        <Link
          to="/transactions"
          search={{ tagId: tag.id }}
          className="text-button"
        >
          <List size={16} aria-hidden="true" />
          View entries
        </Link>
        {writable && (
          <>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setRenameText(tag.name);
                setError("");
                setDialog({ kind: "rename", tag });
              }}
            >
              <Pencil size={16} aria-hidden="true" />
              Rename
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => prepareTagArchive(ledgerId, tag, !tag.archivedAt)(),
                  "Couldn't change the tag.",
                ).then((done) =>
                  done
                    ? setNotice(
                        tag.archivedAt
                          ? `Unarchived ${tag.name}.`
                          : `Archived ${tag.name}. It stays on its entries.`,
                      )
                    : undefined,
                )
              }
            >
              {tag.archivedAt ? (
                <ArchiveRestore size={16} aria-hidden="true" />
              ) : (
                <Archive size={16} aria-hidden="true" />
              )}
              {tag.archivedAt ? "Unarchive" : "Archive"}
            </button>
            <button
              type="button"
              className="text-button danger-action"
              disabled={busy}
              onClick={() => {
                setError("");
                setDialog({ kind: "delete", tag });
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
  const close = () => {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR LEDGER</p>
        <h1 id="tags-title" tabIndex={-1}>
          Tags
        </h1>
        <p className="muted">
          Free-form labels for entries, like a trip or a reimbursable cost. Tags
          never change a balance, a budget or a total.
        </p>
      </div>
      {writable && (
        <form
          className="tag-add"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="new-tag-name">New tag</label>
          <div className="tag-add-row">
            <input
              id="new-tag-name"
              value={newName}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button type="submit" disabled={busy || !newName.trim()}>
              Add tag
            </Button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && !dialog && (
        <p role="alert" className="field-error account-error">
          {error}
        </p>
      )}
      {tags.isPending && <p role="status">Loading tags…</p>}
      {tags.isError && (
        <div className="account-error">
          <p role="alert">Couldn't load your tags.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void tags.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {tags.data && items.length === 0 && (
        <p className="muted">
          No tags yet. Add one here, or type a new name in the Tags box when you
          add an entry.
        </p>
      )}
      {active.length > 0 && <ul className="tag-list">{active.map(row)}</ul>}
      {archived.length > 0 && (
        <>
          <h2>Archived</h2>
          <p className="muted">
            Hidden from the tag lists when you add an entry, but still on the
            entries that have them.
          </p>
          <ul className="tag-list">{archived.map(row)}</ul>
        </>
      )}
      <EditorDialog
        open={dialog?.kind === "rename"}
        title="Rename tag"
        description="Entries show the new name straight away."
        busy={busy}
        onDismiss={close}
        returnFocusId="new-tag-name"
        fallbackFocusId="main-content"
        closeLabel="Close rename dialog"
        initialFocusId="rename-tag-name"
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "rename") return;
            const parsed = tagNameSchema.safeParse(renameText);
            if (!parsed.success) {
              setError(
                "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
              );
              return;
            }
            const { tag } = dialog;
            void run(
              () => prepareTagRename(ledgerId, tag, parsed.data)(),
              "Couldn't rename the tag.",
            ).then((done) => {
              if (done) {
                setDialog(null);
                setNotice(`Renamed to ${parsed.data}.`);
              }
            });
          }}
        >
          <div className="account-fields">
            <label htmlFor="rename-tag-name">Name</label>
            <input
              id="rename-tag-name"
              value={renameText}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => setRenameText(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="field-error account-error">
              {error}
            </p>
          )}
          <div className="account-dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save name"}
            </Button>
          </div>
        </form>
      </EditorDialog>
      <EditorDialog
        open={dialog?.kind === "delete"}
        title="Delete tag"
        description="Only a tag no entry uses can be deleted."
        busy={busy}
        onDismiss={close}
        returnFocusId="new-tag-name"
        fallbackFocusId="main-content"
        closeLabel="Close delete dialog"
        initialFocusId="delete-tag-cancel"
      >
        {dialog?.kind === "delete" && (
          <>
            <p>
              Delete <strong>{dialog.tag.name}</strong>?{" "}
              {dialog.tag.usageCount > 0
                ? `${dialog.tag.usageCount === 1 ? "1 entry has" : `${dialog.tag.usageCount} entries have`} this tag, so it can't be deleted. Archive it to hide it instead.`
                : "No entry has it. This can't be undone, but you can add the tag again any time."}
            </p>
            {error && (
              <p role="alert" className="field-error account-error">
                {error}
              </p>
            )}
            <div className="account-dialog-actions">
              <button
                type="button"
                id="delete-tag-cancel"
                className="secondary-button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger-action"
                disabled={busy || dialog.tag.usageCount > 0}
                onClick={() => {
                  const { tag } = dialog;
                  void run(
                    () => prepareTagDelete(ledgerId, tag)(),
                    "Couldn't delete the tag.",
                  ).then((done) => {
                    if (done) {
                      setDialog(null);
                      setNotice(`Deleted the tag ${tag.name}.`);
                    }
                  });
                }}
              >
                {busy ? "Deleting…" : "Delete tag"}
              </button>
            </div>
          </>
        )}
      </EditorDialog>
    </>
  );
}
