import type { DeletedUser, ManagedUser } from "@ledgerline/shared";
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
import { Fold } from "../../components/fold";
import { LoadError } from "../../components/load-error";
import { Toast } from "../../components/toast";
import { daysLeft, daysLeftText, isUrgent } from "../../lib/days-left";
import { getMe, meKey } from "../profile/api";
import { usePageAdd } from "../shell/page-add";
import { AddUserSheet } from "./add-user-sheet";
import { deletedUsersKey, listDeletedUsers, listUsers, usersKey } from "./api";
import { DeletedUserSheet } from "./deleted-user-sheet";
import { userHint, userPill } from "./model";
import { UserSheet } from "./user-sheet";
import "./users.css";

type Open = { id: number; person?: ManagedUser; gone?: DeletedUser };

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
  const deleted = useQuery({
    queryKey: deletedUsersKey,
    queryFn: listDeletedUsers,
    enabled: admin,
  });
  const [open, setOpen] = useState<Open | null>(null);
  // One notice for the page; its number restarts the timer when the same words come twice in a row.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const start = (person?: ManagedUser, gone?: DeletedUser) => {
    setNotice(null);
    setOpen({
      id: Date.now(),
      ...(person ? { person } : {}),
      ...(gone ? { gone } : {}),
    });
  };
  usePageAdd(
    admin
      ? { label: "Add user", disabled: false, onClick: () => start() }
      : null,
  );
  const saved = (text: string) => {
    setOpen(null);
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text }));
    // `usersKey` is the start of the deleted list's key too, so both lists are read again.
    void client.invalidateQueries({ queryKey: usersKey });
  };
  const items = users.data?.items ?? [];
  const waiting = deleted.data?.items ?? [];
  const waitingRow = (person: DeletedUser) => {
    const days = daysLeft(person.purgeAt);
    return (
      <ListRow
        key={person.id}
        lead={<Avatar name={person.name} />}
        title={person.name}
        hint={person.email}
        value={
          <StatusPill tone={isUrgent(days) ? "warning" : "neutral"}>
            {daysLeftText(days)}
          </StatusPill>
        }
        chevron
        render={(inner, className) => (
          <button
            type="button"
            id={`user-${person.id}`}
            className={className}
            onClick={() => start(undefined, person)}
          >
            {inner}
          </button>
        )}
      />
    );
  };
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
      {users.data && deleted.isError && (
        <LoadError
          message="We couldn't load recently deleted people."
          onRetry={() => void deleted.refetch()}
        />
      )}
      {waiting.length > 0 && (
        <Fold summary={`${waiting.length} recently deleted`}>
          {waiting.map(waitingRow)}
        </Fold>
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
      {open && !open.person && !open.gone && (
        <AddUserSheet
          key={open.id}
          onDismiss={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {open?.gone && (
        <DeletedUserSheet
          key={open.id}
          person={open.gone}
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
