import type { ManagedUser } from "@ledgerline/shared";
import {
  Avatar,
  EmptyState,
  ListCard,
  ListRow,
  StatusPill,
} from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { LoadError } from "../../components/load-error";
import { Toast } from "../../components/toast";
import { getMe, meKey } from "../profile/api";
import { usePageAdd } from "../shell/page-add";
import { AddUserSheet } from "./add-user-sheet";
import { listUsers, usersKey } from "./api";
import { userHint, userPill } from "./model";
import { UserSheet } from "./user-sheet";
import "./users.css";

type Open = { id: number; person?: ManagedUser };

const toProfile = (inner: ReactNode, className: string): ReactElement => (
  <Link to="/profile" className={className}>
    {inner}
  </Link>
);

/**
 * Users (ADR 0048, the prototype's `R.users` and `R["users/empty"]`), for the admin only: one card of the people on
 * this server, each with a name, an email and one pill when it matters. The admin's own row opens Profile; every
 * other row opens that person's sheet. The page holds nothing about money: the server sends account facts only.
 */
export function UsersPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: meKey, queryFn: getMe });
  const admin = me.data?.isAdmin === true;
  const users = useQuery({
    queryKey: usersKey,
    queryFn: listUsers,
    enabled: admin,
  });
  const [open, setOpen] = useState<Open | null>(null);
  // One notice for the page; its number restarts the timer when the same words come twice in a row.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const start = (person?: ManagedUser) => {
    setNotice(null);
    setOpen({ id: Date.now(), ...(person ? { person } : {}) });
  };
  usePageAdd(
    admin
      ? { label: "Add user", disabled: false, onClick: () => start() }
      : null,
  );
  const saved = (text: string) => {
    setOpen(null);
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text }));
    void client.invalidateQueries({ queryKey: usersKey });
  };
  const items = users.data?.items ?? [];
  const row = (person: ManagedUser) => {
    const pill = userPill(person);
    const mine = person.id === me.data?.id;
    return (
      <ListRow
        key={person.id}
        lead={<Avatar name={person.name} />}
        title={person.name}
        hint={userHint(person)}
        {...(pill
          ? { value: <StatusPill tone={pill.tone}>{pill.text}</StatusPill> }
          : {})}
        {...(mine ? { valueHint: "You" } : {})}
        chevron
        render={
          mine
            ? toProfile
            : (inner, className) => (
                <button
                  type="button"
                  id={`user-${person.id}`}
                  className={className}
                  onClick={() => start(person)}
                >
                  {inner}
                </button>
              )
        }
      />
    );
  };
  return (
    <div className="us-page">
      <div className="page-heading us-head">
        <h1 id="users-title" tabIndex={-1}>
          Users
        </h1>
        {admin && (
          <button
            type="button"
            id="add-user"
            className="ui-btn ui-btn-primary us-add"
            onClick={() => start()}
          >
            <Plus size={18} aria-hidden="true" />
            Add user
          </button>
        )}
      </div>
      {me.isError && (
        <LoadError
          message="We couldn't check who you are."
          onRetry={() => void me.refetch()}
        />
      )}
      {me.data && !admin && (
        <div className="ui-card">
          <EmptyState text="Only the admin can manage users." />
        </div>
      )}
      {admin && users.isPending && (
        <p className="muted" role="status">
          Loading people…
        </p>
      )}
      {users.isError && (
        <LoadError
          message="We couldn't load the list."
          onRetry={() => void users.refetch()}
        />
      )}
      {users.data && <ListCard>{items.map(row)}</ListCard>}
      {users.data && items.length === 1 && (
        <div className="ui-card">
          <EmptyState
            text="Only you have an account."
            action={{ label: "Add user", onClick: () => start() }}
          />
        </div>
      )}
      {notice && (
        <Toast
          key={notice.id}
          label="Users notification"
          durationMs={4000}
          onExpire={() => setNotice(null)}
        >
          <p role="status">{notice.text}</p>
        </Toast>
      )}
      {open && !open.person && (
        <AddUserSheet
          key={open.id}
          onDismiss={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {open?.person && (
        <UserSheet
          key={open.id}
          person={open.person}
          onDismiss={() => setOpen(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
