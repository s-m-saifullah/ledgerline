import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { expect, it } from "vitest";
import { forgetPerson, forgetSession } from "./session-cache";

const filled = () => {
  const client = new QueryClient();
  for (const key of [
    ["session"],
    ["me"],
    ["users"],
    ["ledgers"],
    ["accounts"],
    ["categories"],
    ["transactions", "x"],
    ["home", "x"],
    ["contacts", "x"],
    ["receivables", "x"],
    ["clientHistory", "x"],
    ["tags", "x"],
    ["settings-something-else"],
  ])
    client.setQueryData(key, { kept: true });
  return client;
};

it("forgetPerson drops who I am and the people list, and nothing else", () => {
  const client = filled();
  forgetPerson(client);
  expect(client.getQueryData(["me"])).toBeUndefined();
  expect(client.getQueryData(["users"])).toBeUndefined();
  expect(client.getQueryData(["ledgers"])).toEqual({ kept: true });
  expect(client.getQueryData(["session"])).toEqual({ kept: true });
});

it("forgetSession signs the session out of the cache and drops the person's ledger data and who they were", async () => {
  const client = filled();
  await forgetSession(client);
  expect(client.getQueryData(["session"])).toBeNull();
  for (const key of [
    ["me"],
    ["users"],
    ["ledgers"],
    ["accounts"],
    ["categories"],
    ["transactions", "x"],
    ["home", "x"],
    ["contacts", "x"],
    ["receivables", "x"],
    ["clientHistory", "x"],
    ["tags", "x"],
  ])
    expect(client.getQueryData(key), key.join("/")).toBeUndefined();
});

// Every family of money a page keeps, named in the web app's own query keys: none may outlive the sign-out.
const allFamilies = [
  ["budgets", "x"],
  ["reports", "x"],
  ["loans", "x"],
  ["loanPeople", "x"],
  ["loanPerson", "x"],
  ["currencies", "x"],
  ["recurring", "x"],
  ["recurring-runs", "x"],
  ["imports", "x"],
  ["rate-lookup", "x"],
  ["changes", "x"],
  ["a-key-added-next-year", "x"],
];

it("forgetSession drops everything the person's pages kept, including keys nobody listed", async () => {
  const client = filled();
  for (const key of allFamilies) client.setQueryData(key, { kept: true });
  await forgetSession(client);
  for (const key of [...allFamilies, ["settings-something-else"]])
    expect(client.getQueryData(key), key.join("/")).toBeUndefined();
  expect(client.getQueryData(["session"])).toBeNull();
});

it("forgetSession also forgets finished changes, which hold what was typed", async () => {
  const client = filled();
  await new MutationObserver(client, {
    mutationFn: async (amount: string) => amount,
  }).mutate("12.34");
  expect(client.getMutationCache().getAll()).toHaveLength(1);
  await forgetSession(client);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it("a page that is watching the session sees it end", async () => {
  const client = filled();
  const watcher = new QueryObserver(client, {
    queryKey: ["session"],
    queryFn: async () => ({ kept: true }),
    staleTime: Infinity,
  });
  const seen: unknown[] = [];
  const stop = watcher.subscribe((result) => seen.push(result.data));
  await forgetSession(client);
  stop();
  expect(watcher.getCurrentResult().data).toBeNull();
  expect(seen.at(-1)).toBeNull();
});
