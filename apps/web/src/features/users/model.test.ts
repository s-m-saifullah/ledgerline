import type { ManagedUser } from "@ledgerline/shared";
import { describe, expect, it, vi } from "vitest";
import {
  deleteConfirmed,
  emailTakenMessage,
  firstName,
  makeTemporaryPassword,
  passwordWords,
  userHint,
  userPill,
} from "./model";

const person = (over: Partial<ManagedUser> = {}): ManagedUser => ({
  id: "0190c0de-0000-7000-8000-000000000001",
  name: "Jordan Lee",
  email: "jordan@example.com",
  isAdmin: false,
  mustChangePassword: false,
  disabled: false,
  twoFactorEnabled: false,
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});

describe("makeTemporaryPassword", () => {
  /** A source that hands out the given bytes in order, as getRandomValues would fill them. */
  const source = (values: number[]) => {
    let at = 0;
    return (array: Uint32Array) => {
      for (let index = 0; index < array.length; index++)
        array[index] = values[at++ % values.length] as number;
      return array;
    };
  };

  it("is three words and a four-digit number, 12 to 128 characters", () => {
    for (let run = 0; run < 200; run++) {
      const password = makeTemporaryPassword();
      expect(password).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(password.length).toBeLessThanOrEqual(128);
    }
  });

  it("uses a list of 128 distinct lowercase words", () => {
    expect(passwordWords).toHaveLength(128);
    expect(new Set(passwordWords).size).toBe(128);
    for (const word of passwordWords) expect(word).toMatch(/^[a-z]{3,7}$/);
  });

  it("picks the words and the number from the random source", () => {
    expect(makeTemporaryPassword(source([0, 1, 0, 2]))).toBe(
      `${passwordWords[0]}-${passwordWords[1]}-1000-${passwordWords[2]}`,
    );
  });

  it("never lets the random source's remainder tilt the number: a draw from the unfair tail is thrown away", () => {
    // 4294967295 is in the unfair tail of 9000 values; the next draw, 8999, is used instead.
    expect(makeTemporaryPassword(source([0, 0, 4294967295, 8999, 0]))).toBe(
      `${passwordWords[0]}-${passwordWords[0]}-9999-${passwordWords[0]}`,
    );
  });

  it("takes every draw from the browser's secure random source", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    makeTemporaryPassword();
    // Three words and the number: four draws.
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it("is a different password on a second call", () => {
    expect(makeTemporaryPassword()).not.toBe(makeTemporaryPassword());
  });
});

describe("userPill", () => {
  it("shows one pill, the admin first, then disabled, then temporary password", () => {
    expect(
      userPill(person({ isAdmin: true, mustChangePassword: true })),
    ).toEqual({ text: "Admin", tone: "accent" });
    expect(
      userPill(person({ disabled: true, mustChangePassword: true })),
    ).toEqual({ text: "Disabled", tone: "neutral" });
    expect(userPill(person({ mustChangePassword: true }))).toEqual({
      text: "Temporary password",
      tone: "warning",
    });
    expect(userPill(person())).toBeNull();
    // An account can be neither the admin and stopped: the admin comes first all the same.
    expect(userPill(person({ isAdmin: true, disabled: true }))).toEqual({
      text: "Admin",
      tone: "accent",
    });
  });
});

describe("userHint", () => {
  it("is the email, the one hint of a row", () => {
    expect(userHint(person())).toBe("jordan@example.com");
  });
});

describe("firstName", () => {
  it("is the first word of the name, and 'They' when there is none", () => {
    expect(firstName("Jordan Lee")).toBe("Jordan");
    expect(firstName("  Riley   Park ")).toBe("Riley");
    expect(firstName("   ")).toBe("They");
  });
});

describe("deleteConfirmed", () => {
  it("needs the person's email, typed in any letter case, with spaces around it ignored", () => {
    expect(deleteConfirmed("jordan@example.com", "jordan@example.com")).toBe(
      true,
    );
    expect(deleteConfirmed("Jordan@Example.com", " jordan@example.com ")).toBe(
      true,
    );
    expect(deleteConfirmed("jordan@example.com", "jordan")).toBe(false);
    expect(deleteConfirmed("jordan@example.com", "")).toBe(false);
  });
});

it("says what a taken email means and what to do", () => {
  expect(emailTakenMessage).toBe(
    "Someone already has that email. Reset that person's password instead.",
  );
});
