import type { Contact } from "@ledgerline/shared";
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
import { Balances } from "./balances";
import {
  type ClientFilter,
  clientHint,
  filterCounts,
  isOpenClient,
} from "./model";

/** The card above the list: what clients owe in all, at today's rates, and how many of them owe. */
function TotalCard({ clients }: { clients: readonly Contact[] }) {
  const owing = clients.filter(isOpenClient);
  const total = owing.reduce((sum, c) => sum + c.openBalance.amount, 0);
  const missing = [...new Set(owing.flatMap((c) => c.unconvertedCurrencies))];
  return (
    <section className="ui-card cl-total" aria-label="Clients owe">
      <p className="cl-label">Clients owe</p>
      <p className="cl-figure">
        <Amount cents={total} />
      </p>
      <p className="cl-count">
        {owing.length} {owing.length === 1 ? "client" : "clients"}
        {missing.length > 0 && ` · Not counting ${missing.join(", ")} yet`}
      </p>
    </section>
  );
}

/** The list pane: the total, a search, the chips and one row per client, the most owed first. */
export function ClientList({
  clients,
  shown,
  filter,
  onFilter,
  text,
  onText,
  selectedId,
  today,
}: {
  clients: readonly Contact[];
  shown: readonly Contact[];
  filter: ClientFilter;
  onFilter: (filter: ClientFilter) => void;
  text: string;
  onText: (text: string) => void;
  selectedId: string | undefined;
  today: string;
}) {
  const counts = filterCounts(clients);
  return (
    <>
      {clients.length > 0 && <TotalCard clients={clients} />}
      <search className="cl-search">
        <label htmlFor="client-search" className="sr-only">
          Search clients
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="client-search"
          type="search"
          maxLength={200}
          value={text}
          placeholder="Search clients"
          onChange={(event) => onText(event.target.value)}
        />
      </search>
      <fieldset className="cl-chips">
        <legend className="sr-only">Client status</legend>
        <FilterChip
          selected={filter === "open"}
          count={counts.open}
          onClick={() => onFilter("open")}
        >
          Open
        </FilterChip>
        <FilterChip
          selected={filter === "settled"}
          count={counts.settled}
          onClick={() => onFilter("settled")}
        >
          Settled
        </FilterChip>
        <FilterChip selected={filter === "all"} onClick={() => onFilter("all")}>
          All
        </FilterChip>
        {counts.archived > 0 && (
          <FilterChip
            selected={filter === "archived"}
            onClick={() => onFilter("archived")}
          >
            Archived
          </FilterChip>
        )}
      </fieldset>
      {shown.length > 0 ? (
        <ListCard>
          {shown.map((client) => {
            const open = isOpenClient(client);
            const hint = clientHint(client, today);
            return (
              <ListRow
                key={client.id}
                lead={<Avatar name={client.name} />}
                title={client.name}
                {...(hint ? { hint } : {})}
                value={
                  open ? (
                    <Balances client={client} short />
                  ) : (
                    <span className="cl-settled">Settled</span>
                  )
                }
                render={(inner, className) => (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    id={`client-${client.id}`}
                    className={`${className} cl-row`}
                    data-selected={
                      client.id === selectedId ? "true" : undefined
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
              clients.length === 0 && !text
                ? "No clients yet."
                : "No clients here."
            }
          />
        </div>
      )}
    </>
  );
}
