import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import {
  checkPasswords,
  nameMessage,
  parseName,
  passwordProblem,
} from "./model";

describe("parseName", () => {
  it("trims, and takes 1 to 100 characters", () => {
    expect(parseName("  Sam  ")).toBe("Sam");
    expect(parseName("a")).toBe("a");
    expect(parseName("x".repeat(100))).toBe("x".repeat(100));
  });
  it("refuses an empty name, a blank one and 101 characters", () => {
    expect(parseName("")).toBeNull();
    expect(parseName("   ")).toBeNull();
    expect(parseName("x".repeat(101))).toBeNull();
  });
  it("says the limit in the message", () => {
    expect(nameMessage).toMatch(/1 to 100/);
  });
});

const ok = {
  currentPassword: "old-password-1",
  newPassword: "a-new-password-2",
  repeat: "a-new-password-2",
};
describe("checkPasswords", () => {
  it("accepts a good change", () => {
    expect(checkPasswords(ok)).toBeNull();
  });
  it("asks for the current password first", () => {
    expect(checkPasswords({ ...ok, currentPassword: "" })).toEqual({
      field: "currentPassword",
      message: "Enter your current password.",
    });
  });
  it("takes 12 to 128 characters for the new one, counting characters", () => {
    expect(
      checkPasswords({
        ...ok,
        newPassword: "x".repeat(11),
        repeat: "x".repeat(11),
      })?.field,
    ).toBe("newPassword");
    expect(
      checkPasswords({
        ...ok,
        newPassword: "x".repeat(12),
        repeat: "x".repeat(12),
      }),
    ).toBeNull();
    expect(
      checkPasswords({
        ...ok,
        newPassword: "x".repeat(128),
        repeat: "x".repeat(128),
      }),
    ).toBeNull();
    expect(
      checkPasswords({
        ...ok,
        newPassword: "x".repeat(129),
        repeat: "x".repeat(129),
      }),
    ).toEqual({
      field: "newPassword",
      message: "Use 128 characters or fewer.",
    });
    expect(
      checkPasswords({ ...ok, newPassword: "short", repeat: "short" })?.message,
    ).toBe("Use 12 characters or more.");
  });
  it("counts a password as the server does: by UTF-16 length, not by letters shown", () => {
    // The server's rule is string length, so the page must not be stricter or looser than it.
    const emoji = "😀".repeat(6); // length 12
    expect(
      checkPasswords({ ...ok, newPassword: emoji, repeat: emoji }),
    ).toBeNull();
  });
  it("wants the two new passwords to agree, spaces included", () => {
    expect(checkPasswords({ ...ok, repeat: "a-new-password-3" })).toEqual({
      field: "repeat",
      message: "The two new passwords are different.",
    });
    expect(checkPasswords({ ...ok, repeat: "a-new-password-2 " })?.field).toBe(
      "repeat",
    );
  });
  it("names the first problem only, in the order of the rows", () => {
    expect(
      checkPasswords({ currentPassword: "", newPassword: "x", repeat: "y" })
        ?.field,
    ).toBe("currentPassword");
    expect(
      checkPasswords({ ...ok, newPassword: "x", repeat: "y" })?.field,
    ).toBe("newPassword");
  });
});

describe("passwordProblem", () => {
  it("puts the server's field errors on their rows", () => {
    expect(
      passwordProblem(
        new ApiError(400, "Check the request fields.", [
          {
            field: "currentPassword",
            message: "That is not your current password.",
          },
        ]),
      ),
    ).toEqual({
      field: "currentPassword",
      message: "That is not your current password.",
    });
    expect(
      passwordProblem(
        new ApiError(400, "Check the request fields.", [
          {
            field: "newPassword",
            message: "Choose a password you do not use now.",
          },
        ]),
      ),
    ).toEqual({
      field: "newPassword",
      message: "Choose a password you do not use now.",
    });
  });
  it("keeps the too-many-attempts answer as a message for the whole sheet", () => {
    expect(
      passwordProblem(
        new ApiError(429, "Too many attempts. Please wait a minute."),
      ),
    ).toEqual({
      field: null,
      message: "Too many attempts. Please wait a minute.",
    });
  });
  it("shows another refusal's own words, and a generic line for anything else", () => {
    expect(
      passwordProblem(new ApiError(403, "Request origin is not allowed.")),
    ).toEqual({
      field: null,
      message: "Request origin is not allowed.",
    });
    expect(passwordProblem(new Error("boom"))).toEqual({
      field: null,
      message: "Couldn't change the password. Please try again.",
    });
  });
  it("does not say a lost answer failed: a server error is not a refusal", () => {
    expect(passwordProblem(new ApiError(500, "x"))).toEqual({
      field: null,
      message: "We couldn't confirm that. Check your connection and try again.",
    });
  });
});
