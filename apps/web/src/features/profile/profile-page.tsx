import {
  Avatar,
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  StatusPill,
} from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { LoadError } from "../../components/load-error";
import { Toast, toastDuration } from "../../components/toast";
import { devicesKey, getDevices } from "../settings/devices-api";
import { getMe, meKey } from "./api";
import { NameSheet } from "./name-sheet";
import { PasswordSheet } from "./password-sheet";
import "./profile.css";

const press =
  (id: string, onClick: () => void) =>
  (inner: ReactNode, className: string): ReactElement => (
    <button type="button" id={id} className={className} onClick={onClick}>
      {inner}
    </button>
  );
const toSettings = (inner: ReactNode, className: string): ReactElement => (
  <Link to="/settings" className={className}>
    {inner}
  </Link>
);

/**
 * Profile (ADR 0048), as the approved prototype draws it: who you are, your password and where the security
 * settings live. Settings keeps Two-factor, the devices and Sign out; two rows here lead to it.
 */
export function ProfilePage() {
  const me = useQuery({ queryKey: meKey, queryFn: getMe });
  const devices = useQuery({ queryKey: devicesKey, queryFn: getDevices });
  const [sheet, setSheet] = useState<"name" | "password" | null>(null);
  // One notice for the page; its number restarts the timer when the same words come twice in a row.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const saved = (text: string) => {
    setSheet(null);
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text }));
  };
  const person = me.data;
  return (
    <div className="pf-page">
      <div className="page-heading">
        <h1 id="profile-title" tabIndex={-1}>
          Profile
        </h1>
      </div>
      {me.isError && (
        <LoadError
          message="We couldn't load your profile."
          onRetry={() => void me.refetch()}
        />
      )}
      {person && (
        <div className="pf-cols">
          <div className="pf-stack">
            <section
              aria-labelledby="profile-account-title"
              className="pf-sect"
            >
              <SectionLabel as="h2" id="profile-account-title">
                Account
              </SectionLabel>
              <ListCard>
                <ListRow
                  lead={<Avatar name={person.name} />}
                  title={person.name}
                  hint={person.email}
                  {...(person.isAdmin
                    ? { value: <StatusPill>Admin</StatusPill> }
                    : {})}
                  chevron
                  render={press("profile-account", () => setSheet("name"))}
                />
              </ListCard>
            </section>
            <section
              aria-labelledby="profile-password-title"
              className="pf-sect"
            >
              <SectionLabel as="h2" id="profile-password-title">
                Password
              </SectionLabel>
              <ListCard>
                <ListRow
                  lead={
                    <IconTile>
                      <KeyRound size={18} />
                    </IconTile>
                  }
                  title="Change password"
                  hint="12 characters or more"
                  chevron
                  render={press("profile-password", () => setSheet("password"))}
                />
              </ListCard>
            </section>
          </div>
          <div className="pf-stack">
            <section
              aria-labelledby="profile-security-title"
              className="pf-sect"
            >
              <SectionLabel as="h2" id="profile-security-title">
                Security
              </SectionLabel>
              <ListCard>
                <ListRow
                  lead={
                    <IconTile>
                      <ShieldCheck size={18} />
                    </IconTile>
                  }
                  title="Two-factor"
                  value={
                    person.twoFactorEnabled ? (
                      <StatusPill>On</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Off</StatusPill>
                    )
                  }
                  chevron
                  render={toSettings}
                />
                <ListRow
                  lead={
                    <IconTile>
                      <Smartphone size={18} />
                    </IconTile>
                  }
                  title="Signed-in devices"
                  {...(devices.data
                    ? { value: String(devices.data.items.length) }
                    : {})}
                  chevron
                  render={toSettings}
                />
              </ListCard>
            </section>
          </div>
        </div>
      )}
      {person && sheet === "name" && (
        <NameSheet
          me={person}
          onDismiss={() => setSheet(null)}
          onSaved={saved}
        />
      )}
      {sheet === "password" && (
        <PasswordSheet onDismiss={() => setSheet(null)} onSaved={saved} />
      )}
      {notice && (
        <Toast
          key={notice.id}
          label="Profile notification"
          durationMs={toastDuration(false)}
          onExpire={() => setNotice(null)}
          onDismiss={() => setNotice(null)}
        >
          <p role="status">{notice.text}</p>
        </Toast>
      )}
    </div>
  );
}
