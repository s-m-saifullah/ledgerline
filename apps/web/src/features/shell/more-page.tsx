import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Coins,
  FileUp,
  HandCoins,
  Repeat,
  Settings,
  Shapes,
  Tags,
  Wallet,
} from "lucide-react";
import { AppVersion } from "./shell";

export function MorePage() {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1>Your space.</h1>
        <p className="muted">
          Your accounts, categories and clients, and the settings behind them.
        </p>
      </div>
      <section className="settings-card">
        <Link to="/accounts" className="settings-link">
          <span className="account-icon">
            <Wallet size={22} />
          </span>
          <div>
            <h2>Accounts</h2>
            <p>Manage your bank accounts, cards, wallets, and balances.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/categories" className="settings-link">
          <span className="account-icon">
            <Shapes size={22} />
          </span>
          <div>
            <h2>Categories</h2>
            <p>
              Create, organize and style your income and expense categories.
            </p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/tags" className="settings-link">
          <span className="account-icon">
            <Tags size={22} />
          </span>
          <div>
            <h2>Tags</h2>
            <p>
              Free-form labels for entries, like a trip or a reimbursable cost.
            </p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/currencies" className="settings-link">
          <span className="account-icon">
            <Coins size={22} />
          </span>
          <div>
            <h2>Currencies</h2>
            <p>Add currencies and keep their exchange rates.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/recurring" className="settings-link">
          <span className="account-icon">
            <Repeat size={22} />
          </span>
          <div>
            <h2>Recurring</h2>
            <p>Rent, salary and regular transfers, created on their dates.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/clients" className="settings-link">
          <span className="account-icon">
            <Wallet size={22} />
          </span>
          <div>
            <h2>Clients</h2>
            <p>Track unpaid services, payments and money owed to you.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/loans" className="settings-link">
          <span className="account-icon">
            <HandCoins size={22} />
          </span>
          <div>
            <h2>Loans</h2>
            <p>Money you lent to or borrowed from friends and family.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/import" className="settings-link">
          <span className="account-icon">
            <FileUp size={22} />
          </span>
          <div>
            <h2>Import and export</h2>
            <p>Bring in a statement saved as CSV, or download your data.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/settings" className="settings-link">
          <span className="account-icon">
            <Settings size={22} />
          </span>
          <div>
            <h2>Settings</h2>
            <p>Theme, privacy, how amounts are typed and your time zone.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <AppVersion phoneOnly />
    </>
  );
}
