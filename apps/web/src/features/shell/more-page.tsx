import {
  Avatar,
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  StatusPill,
} from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { Amount } from "../../components/amount-text";
import type { Session } from "../../lib/api";
import { getHome } from "../../lib/home-summary";
import { getMe } from "../../lib/me";
import { useCurrentMonth } from "../../lib/month";
import "./more.css";
import { moreGroupsFor } from "../../lib/nav";
import { queryKeys } from "../../lib/query-keys";
import { useLedger } from "../../lib/use-ledger";

/** As the prototype draws it, a row has a hint only where there is something to say: Settings carries the version, which used to be a line at the foot. Clients and Loans say who owes when someone does. */
const hints: Record<string, string> = {
  "/settings": `Version ${__APP_VERSION__.replace(/^v/, "")}`,
};

const linkTo =
  (to: string) =>
  (inner: ReactNode, className: string): ReactElement => (
    <Link to={to} className={className}>
      {inner}
    </Link>
  );

/** More (ADR 0047): More's pages in three groups of rows, with the two figures of money owed that the web keeps apart. */
export function MorePage() {
  const month = useCurrentMonth();
  const { ledger } = useLedger();
  // The same query Home and Loans use, so a page opened from either shows its figures at once.
  const summary = useQuery({
    queryKey: queryKeys.home(ledger?.id, month),
    queryFn: ({ signal }) => getHome(ledger?.id as string, month, signal),
    enabled: !!ledger,
  });
  // Profile comes first (ADR 0048). The name is known at once from the session; the Admin pill follows `/me`.
  const me = useQuery({ queryKey: queryKeys.me, queryFn: getMe });
  const session = useQueryClient().getQueryData<Session | null>(
    queryKeys.session,
  );
  const name = me.data?.name ?? session?.user.name;
  const owed = summary.data?.owed;
  const lent = summary.data?.loans.lent;
  const figure = (to: string) => {
    if (to === "/clients" && owed && owed.total.amount > 0)
      return {
        value: owed.total.amount,
        hint: `${owed.personCount} ${owed.personCount === 1 ? "client owes" : "clients owe"} you`,
      };
    if (to === "/loans" && lent && lent.amount > 0)
      return { value: lent.amount, hint: "People owe you" };
    return null;
  };
  return (
    <div className="more">
      <div className="page-heading">
        <h1>More</h1>
      </div>
      {name && (
        <section className="more-sect" aria-label="Profile">
          <ListCard>
            <ListRow
              lead={<Avatar name={name} />}
              title={name}
              hint="Profile and password"
              {...(me.data?.isAdmin
                ? { value: <StatusPill>Admin</StatusPill> }
                : {})}
              chevron
              render={linkTo("/profile")}
            />
          </ListCard>
        </section>
      )}
      <div className="more-grid">
        {moreGroupsFor(me.data?.isAdmin === true).map((group, index) => (
          <section
            key={group.label}
            className={`more-sect more-g${index + 1}`}
            aria-labelledby={`more-group-${index}`}
          >
            <SectionLabel as="h2" id={`more-group-${index}`}>
              {group.label}
            </SectionLabel>
            <ListCard>
              {group.pages.map(({ to, label, icon: Icon }) => {
                const owedFigure = figure(to);
                return (
                  <ListRow
                    key={to}
                    lead={
                      <IconTile>
                        <Icon size={18} />
                      </IconTile>
                    }
                    title={label}
                    {...((owedFigure?.hint ?? hints[to])
                      ? { hint: (owedFigure?.hint ?? hints[to]) as string }
                      : {})}
                    {...(owedFigure
                      ? {
                          value: (
                            <Amount cents={owedFigure.value} currency="USD" />
                          ),
                        }
                      : {})}
                    chevron
                    render={linkTo(to)}
                  />
                );
              })}
            </ListCard>
          </section>
        ))}
      </div>
    </div>
  );
}
