import type { Tag } from "@ledgerline/shared";
import { EmptyState, IconTile, ListCard, RowBody } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, TagIcon } from "lucide-react";
import { useState } from "react";
import { Fold } from "../../components/fold";
import { LoadError } from "../../components/load-error";
import { Toast } from "../../components/toast";
import { getLedgers } from "../../lib/api";
import { usePageAdd } from "../shell/page-add";
import { splitTags, tagHint } from "./model";
import { TagSheet } from "./tag-sheet";
import { useTags } from "./use-tags";
import "./tags.css";

export function TagsPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <p role="status">Opening your tags…</p>;
  if (ledgers.isError || !ledger)
    return (
      <div className="tg-page">
        <div className="page-heading">
          <h1 id="tags-title" tabIndex={-1}>
            Tags
          </h1>
        </div>
        <LoadError
          message="Couldn't load your ledger."
          onRetry={() => void ledgers.refetch()}
        />
      </div>
    );
  return (
    <LedgerTags
      key={ledger.id}
      ledgerId={ledger.id}
      writable={ledger.role !== "viewer"}
    />
  );
}

type Open = { id: number; tag?: Tag };

/**
 * Tags (ADR 0047, the prototype's `R.tags`): a search, one card of rows (the name and how many entries use it),
 * the archived tags in a fold, and one sheet per tag for everything one can do with it. A viewer's row goes
 * straight to the tag's entries.
 */
function LedgerTags({
  ledgerId,
  writable,
}: {
  ledgerId: string;
  writable: boolean;
}) {
  const client = useQueryClient();
  const tags = useTags(ledgerId);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [notice, setNotice] = useState("");
  const { active, archived } = splitTags(tags.data ?? [], query);
  const start = (tag?: Tag) => {
    setNotice("");
    setOpen({ id: Date.now(), ...(tag ? { tag } : {}) });
  };
  usePageAdd(
    writable
      ? { label: "Add tag", disabled: false, onClick: () => start() }
      : null,
  );
  const row = (tag: Tag) => {
    const body = (
      <RowBody
        lead={
          <IconTile>
            <TagIcon size={20} aria-hidden="true" />
          </IconTile>
        }
        title={tag.name}
        hint={tagHint(tag)}
        chevron
      />
    );
    return writable ? (
      <button
        key={tag.id}
        type="button"
        id={`tag-${tag.id}`}
        className="ui-row ui-row-press tg-row"
        onClick={() => start(tag)}
      >
        {body}
      </button>
    ) : (
      <Link
        key={tag.id}
        id={`tag-${tag.id}`}
        to="/transactions"
        search={{ tagId: tag.id }}
        className="ui-row ui-row-press tg-row"
      >
        {body}
      </Link>
    );
  };
  const none = (tags.data?.length ?? 0) === 0;
  return (
    <div className="tg-page">
      <div className="page-heading tg-head">
        <h1 id="tags-title" tabIndex={-1}>
          Tags
        </h1>
        {writable && (
          <button
            type="button"
            id="add-tag"
            className="ui-btn ui-btn-primary tg-add"
            onClick={() => start()}
          >
            <Plus size={18} aria-hidden="true" />
            Add tag
          </button>
        )}
      </div>
      <search className="tg-search">
        <label htmlFor="tag-search" className="sr-only">
          Search tags
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="tag-search"
          type="search"
          maxLength={40}
          value={query}
          placeholder="Search tags"
          onChange={(event) => setQuery(event.target.value)}
        />
      </search>
      {tags.isPending && (
        <p className="muted" role="status">
          Loading tags…
        </p>
      )}
      {tags.isError && (
        <LoadError
          message="Couldn't load your tags."
          onRetry={() => void tags.refetch()}
        />
      )}
      {tags.data && none && (
        <div className="ui-card">
          <EmptyState text="No tags yet." />
        </div>
      )}
      {tags.data && !none && active.length + archived.length === 0 && (
        <div className="ui-card">
          <EmptyState text="No tag matches." />
        </div>
      )}
      {active.length > 0 && <ListCard>{active.map(row)}</ListCard>}
      {archived.length > 0 && (
        <Fold summary={`${archived.length} archived`}>{archived.map(row)}</Fold>
      )}
      {notice && (
        <Toast
          label="Tag notification"
          durationMs={3000}
          onExpire={() => setNotice("")}
        >
          <p role="status">{notice}</p>
        </Toast>
      )}
      {open && (
        <TagSheet
          key={open.id}
          ledgerId={ledgerId}
          tag={open.tag}
          onDismiss={() => setOpen(null)}
          onSaved={(done) => {
            setOpen(null);
            setNotice(done);
            void client.invalidateQueries({ queryKey: ["tags", ledgerId] });
          }}
        />
      )}
    </div>
  );
}
