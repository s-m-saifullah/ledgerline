import { ListCard, SectionLabel } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { NativeSelect } from "../../components/native-select";
import { ApiError, getLedgers } from "../../lib/api";
import { prepareLedgerTimeZone } from "./api";

function zoneNames(): string[] {
  const names =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return names.includes("UTC") ? names : ["UTC", ...names];
}

/**
 * The ledger's time zone decides what "today" means for scheduled work such as recurring entries. Choosing a
 * zone saves it at once, as the prototype's row has no Save button; the owner sees a short notice.
 */
export function TimeZoneCard({
  onNotice,
}: {
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const isOwner = ledger?.role === "owner";
  const saved = ledger?.timeZone ?? "";
  const options = useMemo(() => {
    const names = zoneNames();
    return [
      { value: "", label: "Choose a time zone", disabled: true as boolean },
      // A zone this browser does not list is still shown when it is the saved one.
      ...(saved && !names.includes(saved) ? [saved, ...names] : names).map(
        (name) => ({
          value: name,
          label: name.replaceAll("_", " "),
          disabled: false,
        }),
      ),
    ];
  }, [saved]);
  const save = async (zone: string) => {
    if (!ledger) return;
    const sig = `${ledger.version}|${zone}`;
    if (attempt.current?.sig !== sig)
      attempt.current = { sig, run: prepareLedgerTimeZone(ledger, zone) };
    setBusy(true);
    setFailure("");
    try {
      await attempt.current.run();
      attempt.current = null;
      await client.invalidateQueries({ queryKey: ["ledgers"] });
      onNotice("Time zone saved.");
    } catch (error) {
      attempt.current = null;
      setFailure(
        error instanceof ApiError && error.status < 500
          ? error.message
          : "We couldn't save that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="ledger-title" className="set-sect">
      <SectionLabel as="h2" id="ledger-title">
        Ledger
      </SectionLabel>
      <ListCard>
        <div className="ui-row ui-row-static set-zone-row">
          <span className="ui-row-main">
            <label htmlFor="ledger-time-zone" className="ui-row-title">
              Time zone
            </label>
            <span id="ledger-time-zone-hint" className="ui-row-hint">
              {ledger && !isOwner
                ? "Only the owner can change this"
                : "Decides what today is"}
            </span>
          </span>
          <span className="set-zone">
            <NativeSelect
              id="ledger-time-zone"
              aria-describedby="ledger-time-zone-hint"
              value={saved}
              disabled={!ledger || !isOwner || busy}
              onChange={(event) => void save(event.target.value)}
            >
              {options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </span>
        </div>
      </ListCard>
      {ledgers.isError && (
        <p role="alert" className="field-error">
          Couldn't load your ledger.
        </p>
      )}
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
    </section>
  );
}
