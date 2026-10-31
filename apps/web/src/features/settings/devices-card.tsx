import {
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  StatusPill,
} from "@ledgerline/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { useState } from "react";
import { LoadError } from "../../components/load-error";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { ActionRow } from "./action-row";
import {
  devicesKey,
  getDevices,
  signOutDevice,
  signOutOtherDevices,
} from "./devices-api";

/** The most recently used devices shown at once; the rest sit behind a disclosure. */
const shownDevices = 10;

/** A short date, with the year only when it is not this year, so the hint stays on one line beside the button. */
const when = (iso: string) => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(date);
};

/** Settings, Signed-in devices: where you are signed in, with a way to sign other devices out (ADR 0042). */
export function DevicesCard({
  onNotice,
}: {
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const devices = useQuery({ queryKey: devicesKey, queryFn: getDevices });
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState("");
  const done = (message: string) => {
    setAsking(false);
    setFailure("");
    onNotice(message);
    return client.invalidateQueries({ queryKey: devicesKey });
  };
  const failed = (error: unknown) => {
    setAsking(false);
    setFailure(
      error instanceof ApiError
        ? error.message
        : "We couldn't sign that device out. Please try again.",
    );
  };
  const one = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => signOutDevice(id),
    onSuccess: (_data, { name }) => done(`Signed out ${name}.`),
    onError: failed,
  });
  const others = useMutation({
    mutationFn: signOutOtherDevices,
    onSuccess: () => done("Signed out your other devices."),
    onError: failed,
  });
  const items = devices.data?.items ?? [];
  const elsewhere = items.filter((item) => !item.current);
  const recent = items.slice(0, shownDevices);
  const older = items.slice(shownDevices);
  const row = (item: (typeof items)[number]) => (
    <ListRow
      key={item.id}
      lead={
        <IconTile>
          <Smartphone size={18} />
        </IconTile>
      }
      title={item.device}
      hint={`Last used ${when(item.lastUsedAt)}`}
      value={
        item.current ? (
          <StatusPill>Current device</StatusPill>
        ) : (
          <button
            type="button"
            className="ui-btn ui-btn-text"
            aria-label={`Sign out ${item.device}`}
            disabled={one.isPending || others.isPending}
            onClick={() => {
              setFailure("");
              one.mutate({ id: item.id, name: item.device });
            }}
          >
            Sign out
          </button>
        )
      }
    />
  );
  return (
    <section aria-labelledby="devices-title" className="set-sect">
      <SectionLabel as="h2" id="devices-title">
        Signed-in devices
      </SectionLabel>
      {devices.isError ? (
        <LoadError
          message="We couldn't load your devices."
          onRetry={() => void devices.refetch()}
        />
      ) : devices.isPending ? (
        <ListCard>
          <div className="ui-row ui-row-static">
            <span className="ui-row-hint">Loading your devices…</span>
          </div>
        </ListCard>
      ) : (
        <>
          <ListCard>
            {recent.map(row)}
            {elsewhere.length === 0 && (
              <div className="ui-row ui-row-static">
                <span className="ui-row-hint">
                  This is the only device signed in.
                </span>
              </div>
            )}
            {elsewhere.length > 0 && (
              <ActionRow
                id="sign-out-others"
                title="Sign out all other devices"
                disabled={others.isPending}
                onClick={() => {
                  setFailure("");
                  setAsking(true);
                }}
              />
            )}
          </ListCard>
          {older.length > 0 && (
            <details className="set-older">
              <summary>
                Show {older.length} older{" "}
                {older.length === 1 ? "device" : "devices"}
              </summary>
              <ListCard>{older.map(row)}</ListCard>
            </details>
          )}
        </>
      )}
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
      <Overlay
        kind="question"
        open={asking}
        title="Sign out all other devices?"
        busy={others.isPending}
        onDismiss={() => setAsking(false)}
        returnFocusId="sign-out-others"
        fallbackFocusId="main-content"
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={others.isPending}
            onClick={() => others.mutate()}
          >
            Sign out all
          </button>
        }
      >
        <p>They will need to sign in again.</p>
      </Overlay>
    </section>
  );
}
