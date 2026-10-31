import { Link } from "@tanstack/react-router";
import { useContext } from "react";
import {
  AmountEntryContext,
  PrivacyControlContext,
  ThemeContext,
} from "../../lib/preferences";
import { TimeZoneCard } from "../ledger/time-zone-card";
import { DevicesCard } from "./devices-card";
import { TwoFactorCard } from "./two-factor-card";

export function SettingsPage() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { privateMode, setPrivateMode } = useContext(PrivacyControlContext);
  const { centsFirst, setCentsFirst } = useContext(AmountEntryContext);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1>Settings</h1>
        <p className="muted">
          The little details that make your ledger feel like home.
        </p>
      </div>
      <section className="settings-card" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <p className="scope-label">This device</p>
        <fieldset className="theme-choice">
          <legend>Theme</legend>
          {(
            [
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <p className="muted">
          System follows your device. The sun or moon button in the header
          switches quickly between light and dark.
        </p>
      </section>
      <section className="settings-card" aria-labelledby="privacy-title">
        <h2 id="privacy-title">Privacy and entry</h2>
        <p className="scope-label">This device</p>
        <label className="budget-rollover amount-entry-toggle">
          <input
            type="checkbox"
            checked={privateMode}
            onChange={(event) => setPrivateMode(event.target.checked)}
          />
          <span className="check-text">Hide amounts</span>
        </label>
        <p className="muted">
          Blurs amounts throughout your ledger. The eye button in the header
          does the same.
        </p>
        <label className="budget-rollover amount-entry-toggle">
          <input
            type="checkbox"
            checked={centsFirst}
            onChange={(event) => setCentsFirst(event.target.checked)}
          />
          <span className="check-text">Type amounts from the cents</span>
        </label>
        <p className="muted">
          On: type digits only and the decimal point stays in place, so 1, 2, 3
          reads 1.23. Off: type amounts the usual way.
        </p>
      </section>
      <TimeZoneCard />
      <TwoFactorCard />
      <DevicesCard />
      <section className="settings-card" aria-labelledby="your-data-title">
        <h2 id="your-data-title">Your data</h2>
        <p className="scope-label">This ledger</p>
        <Link to="/import" className="ui-btn ui-btn-secondary">
          Import and export
        </Link>
      </section>
    </>
  );
}
