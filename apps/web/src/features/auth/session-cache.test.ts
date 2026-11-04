import { QueryClient } from "@tanstack/react-query";
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
  // Anything else is left as it was.
  expect(client.getQueryData(["settings-something-else"])).toEqual({
    kept: true,
  });
});
