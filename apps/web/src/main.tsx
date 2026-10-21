import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountsPage } from "./features/accounts/accounts-page";
import { SignIn } from "./features/auth/sign-in";
import { BudgetsPage } from "./features/budgets/budgets-page";
import { CategoriesPage } from "./features/categories/categories-page";
import { ClientsPage } from "./features/clients/clients-page";
import { CurrenciesPage } from "./features/currencies/currencies-page";
import { HomePage } from "./features/home/home-page";
import { ImportPage } from "./features/imports/import-page";
import { InsightsPage } from "./features/insights/insights-page";
import { LoansPage } from "./features/loans/loans-page";
import { RecurringPage } from "./features/recurring/recurring-page";
import { SettingsPage } from "./features/settings/settings-page";
import { EmptyPage, MorePage, Shell } from "./features/shell/shell";
import { TagsPage } from "./features/tags/tags-page";
import { transactionSearchSchema } from "./features/transactions/filters";
import { TransactionsPage } from "./features/transactions/transactions-page";
import { getSession } from "./lib/api";
import {
  AmountEntryContext,
  PrivacyContext,
  PrivacyControlContext,
  ThemeContext,
  usePreferences,
} from "./lib/preferences";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
function Root() {
  const preferences = usePreferences();
  const session = useQuery({ queryKey: ["session"], queryFn: getSession });
  if (session.isPending)
    return (
      <main className="loading" role="status">
        Opening your ledger…
      </main>
    );
  if (session.isError)
    return (
      <main className="loading">
        <h1>Couldn't reach your ledger.</h1>
        <p>Please try again in a moment.</p>
        <button
          type="button"
          className="button"
          onClick={() => void session.refetch()}
        >
          Try again
        </button>
      </main>
    );
  if (!session.data)
    return (
      <SignIn
        onSuccess={async () => {
          await client.invalidateQueries({ queryKey: ["session"] });
        }}
      />
    );
  return (
    <PrivacyContext value={preferences.privateMode}>
      <PrivacyControlContext
        value={{
          privateMode: preferences.privateMode,
          setPrivateMode: preferences.setPrivateMode,
        }}
      >
        <AmountEntryContext
          value={{
            centsFirst: preferences.centsFirst,
            setCentsFirst: preferences.setCentsFirst,
          }}
        >
          <ThemeContext
            value={{ theme: preferences.theme, setTheme: preferences.setTheme }}
          >
            <Shell
              key={session.data.user.id}
              preferences={preferences}
              session={session.data}
              onSignOut={async () => {
                await client.cancelQueries();
                client.setQueryData(["session"], null);
                client.removeQueries({ queryKey: ["ledgers"] });
                client.removeQueries({ queryKey: ["accounts"] });
                client.removeQueries({ queryKey: ["categories"] });
                client.removeQueries({ queryKey: ["transactions"] });
                client.removeQueries({ queryKey: ["home"] });
                for (const key of [
                  "contacts",
                  "receivables",
                  "clientHistory",
                  "tags",
                ])
                  client.removeQueries({ queryKey: [key] });
                await router.navigate({ to: "/" });
              }}
            />
          </ThemeContext>
        </AmountEntryContext>
      </PrivacyControlContext>
    </PrivacyContext>
  );
}
const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <EmptyPage
      title="Page not found"
      description="Choose a page from the navigation to continue."
      icon={Layers}
    />
  ),
});
const home = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
const transactions = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  validateSearch: (search) => transactionSearchSchema.parse(search),
  component: TransactionsPage,
});
const budgets = createRoute({
  getParentRoute: () => rootRoute,
  path: "/budgets",
  component: BudgetsPage,
});
const insights = createRoute({
  getParentRoute: () => rootRoute,
  path: "/insights",
  component: InsightsPage,
});
const more = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more",
  component: MorePage,
});
const accounts = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsPage,
});
const categories = createRoute({
  getParentRoute: () => rootRoute,
  path: "/categories",
  component: CategoriesPage,
});
const currenciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/currencies",
  component: CurrenciesPage,
});
const recurring = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recurring",
  component: RecurringPage,
});
const clients = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients",
  component: ClientsPage,
});
const settings = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: ImportPage,
});
const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tags",
  component: TagsPage,
});
const loans = createRoute({
  getParentRoute: () => rootRoute,
  path: "/loans",
  component: LoansPage,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    home,
    transactions,
    budgets,
    insights,
    more,
    accounts,
    categories,
    tagsRoute,
    currenciesRoute,
    recurring,
    clients,
    loans,
    importRoute,
    settings,
  ]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
// The installable app's service worker (ADR 0041): production builds only, so development and tests are unaffected.
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
