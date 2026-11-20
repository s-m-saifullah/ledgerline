import { expect, it } from "vitest";
import { accountFormSchema, formDefaults } from "./form";

const problems = (bonusRate: string, amount = "0.00") => {
  const result = accountFormSchema.safeParse({
    ...formDefaults(undefined),
    name: "Wallet",
    amount,
    bonusRate,
  });
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

it("takes a bonus rate typed as .8 or 8. as 0.8 and 8", () => {
  expect(problems(".8")).not.toContain("bonusRate");
  expect(problems("8.")).not.toContain("bonusRate");
  expect(problems("0.8")).not.toContain("bonusRate");
});
it("still refuses a bonus rate that is not one percentage", () => {
  for (const text of [".", "1.2.3", "abc", "500", ".005"])
    expect(problems(text), text).toContain("bonusRate");
});
it("takes an opening balance typed as .8 or 8.", () => {
  expect(problems("", ".8")).not.toContain("amount");
  expect(problems("", "8.")).not.toContain("amount");
});
