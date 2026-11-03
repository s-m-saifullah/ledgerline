import { describe, expect, it } from "vitest";
import { changePasswordSchema, updateMeSchema } from "./me";

describe("account schemas", () => {
  it("trims a name and keeps it between 1 and 100 characters", () => {
    expect(updateMeSchema.parse({ name: "  Sam  " }).name).toBe("Sam");
    expect(updateMeSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateMeSchema.safeParse({ name: "a".repeat(100) }).success).toBe(
      true,
    );
    expect(updateMeSchema.safeParse({ name: "a".repeat(101) }).success).toBe(
      false,
    );
  });

  it("asks for 12 to 128 characters and signs other devices out unless told not to", () => {
    const base = { currentPassword: "old-password-here" };
    expect(
      changePasswordSchema.parse({ ...base, newPassword: "a".repeat(12) })
        .signOutOtherDevices,
    ).toBe(true);
    expect(
      changePasswordSchema.parse({
        ...base,
        newPassword: "a".repeat(12),
        signOutOtherDevices: false,
      }).signOutOtherDevices,
    ).toBe(false);
    for (const newPassword of ["a".repeat(11), "a".repeat(129)])
      expect(
        changePasswordSchema.safeParse({ ...base, newPassword }).success,
      ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "",
        newPassword: "a".repeat(12),
      }).success,
    ).toBe(false);
  });
});
