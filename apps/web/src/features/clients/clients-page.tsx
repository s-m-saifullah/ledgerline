import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadError } from "../../components/load-error";
import { getLedgers } from "../../lib/api";
import { useCurrentMonth } from "../../lib/month";
import { localToday } from "../../lib/time";
import { useAppWide } from "../../lib/use-app-width";
import { usePageAdd } from "../shell/page-add";
import { getAllClients } from "./api";
import { ClientDetail } from "./client-detail";
import { ClientList } from "./client-list";
import { type ClientFilter, resolveFilter, visibleClients } from "./model";
import { useClientsWorkspace } from "./workspace";
import "./clients.css";

/**
 * Clients (ADR 0047, the prototype's `R.clients`): the list and one client beside it from 1100 px, one at a
 * time below. The client is in the address (`/clients/{id}`); on a wide page with none chosen the first one is
 * open. CSS decides which panes show, and the width is read here only to skip fetching a pane nobody sees.
 */
export function ClientsPage() {
  const { clientId } = useParams({ strict: false }) as { clientId?: string };
  const navigate = useNavigate();
  const month = useCurrentMonth();
  const wide = useAppWide(1100);
  const workspace = useClientsWorkspace();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const blocked = workspace?.blocked ?? false;
  const clients = useQuery({
    queryKey: ["contacts", ledger?.id, "book", month],
    queryFn: ({ signal }) => getAllClients(ledger?.id as string, signal, month),
    enabled: !!ledger,
  });
  const [chosen, setChosen] = useState<ClientFilter | null>(null);
  const [text, setText] = useState("");
  const all = clients.data ?? [];
  const filter = resolveFilter(chosen, all);
  const shown = visibleClients(all, filter, text);
  const selectedId = clientId ?? (wide ? shown[0]?.id : undefined);
  const selected = all.find((c) => c.id === selectedId);
  const deletedClientId = workspace?.deletedClientId ?? null;
  useEffect(() => {
    if (deletedClientId && deletedClientId === clientId)
      void navigate({ to: "/clients" });
  }, [deletedClientId, clientId, navigate]);
  const addClient = () =>
    workspace?.open(
      { kind: "contact" },
      clientId ? "mobile-add-page" : "add-client",
    );
  const logService = () =>
    selected &&
    workspace?.open({ kind: "service", client: selected }, "mobile-add-page");
  // A phone's one Add button adds what the screen lists: clients on the list, services on a client.
  usePageAdd(
    !writable
      ? null
      : clientId
        ? {
            label: "Log service",
            disabled: blocked || !selected || !!selected.archivedAt,
            onClick: logService,
          }
        : { label: "Add client", disabled: blocked, onClick: addClient },
  );
  return (
    <div className="cl-page">
      <div className="page-heading cl-head" data-open={!!clientId}>
        <h1 id="clients-title" tabIndex={-1}>
          Clients
        </h1>
        <div className="cl-head-actions">
          <Link to="/clients" className="ui-btn ui-btn-text cl-back">
            All clients
          </Link>
          {writable && (
            <button
              type="button"
              id="add-client"
              className="ui-btn ui-btn-primary cl-add"
              disabled={blocked}
              onClick={addClient}
            >
              <Plus size={18} aria-hidden="true" />
              Add client
            </button>
          )}
        </div>
      </div>
      {ledgers.isError ? (
        <LoadError
          message="Couldn't load your ledger."
          onRetry={() => void ledgers.refetch()}
        />
      ) : !ledger ? (
        <p className="muted" role="status">
          Loading your ledger…
        </p>
      ) : clients.isError ? (
        <LoadError
          message="Couldn't load clients."
          onRetry={() => void clients.refetch()}
        />
      ) : !clients.data ? (
        <p className="muted" role="status">
          Loading clients…
        </p>
      ) : (
        <div className="cl-split" data-open={!!clientId}>
          <div className="cl-list">
            <ClientList
              clients={all}
              shown={shown}
              filter={filter}
              onFilter={setChosen}
              text={text}
              onText={setText}
              selectedId={selectedId}
              today={localToday()}
            />
          </div>
          <div className="cl-detail">
            {selectedId && (
              <ClientDetail
                key={selectedId}
                ledgerId={ledger.id}
                clientId={selectedId}
                fallback={selected}
                month={month}
                writable={writable}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
