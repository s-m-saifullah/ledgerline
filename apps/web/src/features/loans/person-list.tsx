import type { LoanPerson } from "@ledgerline/shared";
import {
  Avatar,
  EmptyState,
  FilterChip,
  ListCard,
  ListRow,
} from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Amount } from "../../components/amount-text";
import { type PeopleFilter, personRow } from "./model";

/** The card above the list: what people owe you and what you owe, each only when it is not zero. */
function Totals({ lent, borrowed }: { lent: number; borrowed: number }) {
  if (lent <= 0 && borrowed <= 0) return null;
  return (
    <section className="ui-card ln-total" aria-label="Loan totals">
      {lent > 0 && (
        <div>
          <p className="ln-label">People owe</p>
          <p className="ln-figure">
            <Amount cents={lent} />
          </p>
        </div>
      )}
      {borrowed > 0 && (
        <div>
          <p className="ln-label">You owe</p>
          <p className="ln-figure">
            <Amount cents={borrowed} />
          </p>
        </div>
      )}
    </section>
  );
}

/** The list pane (the prototype's `R.loans`): the totals, search from eight people, chips while someone is archived, one row each. */
export function PersonList({
  people,
  shown,
  filter,
  chips,
  search,
  text,
  onText,
  onFilter,
  selectedId,
  lent,
  borrowed,
}: {
  people: readonly LoanPerson[];
  shown: readonly LoanPerson[];
  filter: PeopleFilter;
  chips: boolean;
  search: boolean;
  text: string;
  onText: (text: string) => void;
  onFilter: (filter: PeopleFilter) => void;
  selectedId: string | undefined;
  lent: number;
  borrowed: number;
}) {
  return (
    <>
      <Totals lent={lent} borrowed={borrowed} />
      {search && (
        <search className="ln-search">
          <label htmlFor="loan-search" className="sr-only">
            Search people
          </label>
          <Search size={18} aria-hidden="true" />
          <input
            id="loan-search"
            type="search"
            maxLength={200}
            value={text}
            placeholder="Search people"
            onChange={(event) => onText(event.target.value)}
          />
        </search>
      )}
      {chips && (
        <fieldset className="ln-chips">
          <legend className="sr-only">Show</legend>
          <FilterChip
            selected={filter === "active"}
            onClick={() => onFilter("active")}
          >
            Active
          </FilterChip>
          <FilterChip
            selected={filter === "archived"}
            onClick={() => onFilter("archived")}
          >
            Archived
          </FilterChip>
          <FilterChip
            selected={filter === "all"}
            onClick={() => onFilter("all")}
          >
            All
          </FilterChip>
        </fieldset>
      )}
      {shown.length > 0 ? (
        <ListCard>
          {shown.map((person) => {
            const row = personRow(person);
            return (
              <ListRow
                key={person.id}
                lead={<Avatar name={person.name} />}
                title={person.name}
                hint={row.hint}
                {...(row.amount
                  ? {
                      value: (
                        <Amount
                          cents={row.amount.cents}
                          currency={row.amount.currency}
                        />
                      ),
                    }
                  : {})}
                render={(inner, className) => (
                  <Link
                    to="/loans/$personId"
                    params={{ personId: person.id }}
                    id={`loan-person-${person.id}`}
                    className={`${className} ln-row-link`}
                    data-selected={
                      person.id === selectedId ? "true" : undefined
                    }
                  >
                    {inner}
                  </Link>
                )}
              />
            );
          })}
        </ListCard>
      ) : (
        <div className="ui-card">
          <EmptyState
            text={
              people.length === 0 && !text ? "No loans yet." : "No one here."
            }
          />
        </div>
      )}
    </>
  );
}
