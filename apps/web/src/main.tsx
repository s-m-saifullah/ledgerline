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
import { BarChart3, Layers } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountsPage } from "./features/accounts/accounts-page";
import { SignIn } from "./features/auth/sign-in";
import { CategoriesPage } from "./features/categories/categories-page";
import { HomePage } from "./features/home/home-page";
import { PeoplePage } from "./features/people/people-page";
import {
  PrivacyContext,
  ThemeContext,
  usePreferences,
} from "./features/shell/preferences";
import { EmptyPage, MorePage, Shell } from "./features/shell/shell";
import { transactionSearchSchema } from "./features/transactions/filters";
import { TransactionsPage } from "./features/transactions/transactions-page";
import { getSession } from "./lib/api";

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
            for (const key of ["contacts", "receivables", "peopleHistory"])
              client.removeQueries({ queryKey: [key] });
            await router.navigate({ to: "/" });
          }}
        />
      </ThemeContext>
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
  component: () => (
    <EmptyPage
      title="Budgets"
      description="Monthly budgets arrive in an upcoming update."
      icon={Layers}
    />
  ),
});
const insights = createRoute({
  getParentRoute: () => rootRoute,
  path: "/insights",
  component: () => (
    <EmptyPage
      title="Insights"
      description="Reports and trends arrive in an upcoming update."
      icon={BarChart3}
    />
  ),
});
const more = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more",
  component: MorePage,
});
const accounts = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more/accounts",
  component: AccountsPage,
});
const categories = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more/categories",
  component: CategoriesPage,
});
const people = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more/people",
  component: PeoplePage,
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
    people,
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
