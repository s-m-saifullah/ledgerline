import { Button } from "@ledgerline/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadError } from "../../components/load-error";
import { ApiError } from "../../lib/api";
import {
  devicesKey,
  getDevices,
  signOutDevice,
  signOutOtherDevices,
} from "./devices-api";

/** The most recently used devices shown at once; the rest sit behind a disclosure. */
const shownDevices = 10;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

/** Settings card: where you are signed in, with a way to sign other devices out (ADR 0042). */
export function DevicesCard() {
  const client = useQueryClient();
  const devices = useQuery({ queryKey: devicesKey, queryFn: getDevices });
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const done = (message: string) => {
    setConfirming(false);
    setFailure("");
    setNotice(message);
    return client.invalidateQueries({ queryKey: devicesKey });
  };
  const failed = (error: unknown) => {
    setConfirming(false);
    setNotice("");
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
    <li key={item.id} className="device-row">
      <div className="device-info">
        <strong>{item.device}</strong>
        {item.current && <span className="account-badge">Current device</span>}
        <span className="muted">Last used {when(item.lastUsedAt)}</span>
      </div>
      {!item.current && (
        <button
          type="button"
          className="text-button"
          aria-label={`Sign out ${item.device}`}
          disabled={one.isPending || others.isPending}
          onClick={() => {
            setNotice("");
            one.mutate({ id: item.id, name: item.device });
          }}
        >
          Sign out
        </button>
      )}
    </li>
  );
  return (
    <section className="settings-card" aria-labelledby="devices-title">
      <h2 id="devices-title">Signed-in devices</h2>
      <p className="scope-label">Your account</p>
      <p>
        Where you are signed in. Sign out a device you no longer use or have
        lost.
      </p>
      {devices.isError ? (
        <LoadError
          message="We couldn't load your devices."
          onRetry={() => void devices.refetch()}
        />
      ) : devices.isPending ? (
        <p>Loading your devices…</p>
      ) : (
        <>
          <ul className="device-list">{recent.map(row)}</ul>
          {older.length > 0 && (
            <details className="device-older">
              <summary>
                Show {older.length} older{" "}
                {older.length === 1 ? "device" : "devices"}
              </summary>
              <ul className="device-list">{older.map(row)}</ul>
            </details>
          )}
        </>
      )}
      {devices.isSuccess && elsewhere.length === 0 && (
        <p>This is the only device signed in.</p>
      )}
      {notice && (
        <p role="status" className="two-factor-notice">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
      {devices.isSuccess && elsewhere.length > 0 && !confirming && (
        <div className="two-factor-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setNotice("");
              setConfirming(true);
            }}
          >
            Sign out all other devices
          </button>
        </div>
      )}
      {confirming && (
        <div className="two-factor-step">
          <p>
            Sign out all your other devices? They will need to sign in again.
          </p>
          <div className="two-factor-actions">
            <Button
              type="button"
              disabled={others.isPending}
              onClick={() => others.mutate()}
            >
              Sign out all
            </Button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
