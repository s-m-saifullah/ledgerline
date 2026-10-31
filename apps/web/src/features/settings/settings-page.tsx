import {
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  SegmentedControl,
  SwitchRow,
} from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import { FileUp, LogOut } from "lucide-react";
import { useContext, useState } from "react";
import { Toast } from "../../components/toast";
import {
  AmountEntryContext,
  PrivacyControlContext,
  SignOutContext,
  ThemeContext,
} from "../../lib/preferences";
import { TimeZoneCard } from "../ledger/time-zone-card";
import { DevicesCard } from "./devices-card";
import "./settings.css";
import { TwoFactorCard } from "./two-factor-card";

const themes = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/** Settings (ADR 0047), as the approved prototype draws it: two columns from 700 px, grouped rows, one notice at a time. */
export function SettingsPage() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { privateMode, setPrivateMode } = useContext(PrivacyControlContext);
  const { centsFirst, setCentsFirst } = useContext(AmountEntryContext);
  const signOut = useContext(SignOutContext);
  // One notice for the whole page; its number restarts the timer when the same words come twice in a row.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const notify = (text: string) =>
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text }));
  return (
    <div className="set-page">
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <div className="set-cols">
        <div className="set-stack">
          <section aria-labelledby="appearance-title" className="set-sect">
            <SectionLabel as="h2" id="appearance-title">
              Appearance
            </SectionLabel>
            <div className="ui-card">
              <SegmentedControl
                label="Theme"
                options={[...themes]}
                value={theme}
                onChange={setTheme}
              />
            </div>
          </section>
          <section aria-labelledby="privacy-title" className="set-sect">
            <SectionLabel as="h2" id="privacy-title">
              Privacy and input
            </SectionLabel>
            <ListCard>
              <SwitchRow
                title="Hide amounts"
                hint="Hides every amount on screen"
                checked={privateMode}
                onChange={setPrivateMode}
              />
              <SwitchRow
                title="Type amounts from the cents"
                hint="1, 2, 3 reads 1.23"
                checked={centsFirst}
                onChange={setCentsFirst}
              />
            </ListCard>
          </section>
          <TimeZoneCard onNotice={notify} />
          <section aria-labelledby="your-data-title" className="set-sect">
            <SectionLabel as="h2" id="your-data-title">
              Your data
            </SectionLabel>
            <ListCard>
              <ListRow
                lead={
                  <IconTile>
                    <FileUp size={18} />
                  </IconTile>
                }
                title="Import and export"
                hint="CSV files, in and out"
                chevron
                render={(inner, className) => (
                  <Link to="/import" className={className}>
                    {inner}
                  </Link>
                )}
              />
            </ListCard>
          </section>
        </div>
        <div className="set-stack">
          <TwoFactorCard onNotice={notify} />
          <DevicesCard onNotice={notify} />
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-danger set-signout"
            onClick={signOut}
          >
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
      {notice && (
        <Toast
          key={notice.id}
          label="Settings notification"
          durationMs={4000}
          onExpire={() => setNotice(null)}
        >
          <p role="status">{notice.text}</p>
        </Toast>
      )}
    </div>
  );
}
