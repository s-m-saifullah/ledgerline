import { ApiError } from "../../lib/api";

/** What the Profile page asks of a name and a password, and how the server's answers land on the rows (ADR 0048). */
export const nameMessage = "Use 1 to 100 characters.";
export const parseName = (raw: string) => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
};

export type PasswordField = "currentPassword" | "newPassword" | "repeat";
export type PasswordInput = {
  currentPassword: string;
  newPassword: string;
  repeat: string;
};
/** The first thing wrong with a password change, in the order of the rows, or null. Length is the server's rule: string length, 12 to 128. */
export function checkPasswords({
  currentPassword,
  newPassword,
  repeat,
}: PasswordInput): { field: PasswordField; message: string } | null {
  if (!currentPassword)
    return {
      field: "currentPassword",
      message: "Enter your current password.",
    };
  if (newPassword.length < 12)
    return { field: "newPassword", message: "Use 12 characters or more." };
  if (newPassword.length > 128)
    return { field: "newPassword", message: "Use 128 characters or fewer." };
  if (repeat !== newPassword)
    return { field: "repeat", message: "The two new passwords are different." };
  return null;
}

/** Where a failed change shows: on the row the server names, or for the whole sheet. */
export function passwordProblem(error: unknown): {
  field: "currentPassword" | "newPassword" | null;
  message: string;
} {
  if (error instanceof ApiError) {
    const named = error.fields.find(
      (item) =>
        item.field === "currentPassword" || item.field === "newPassword",
    );
    if (named)
      return {
        field: named.field as "currentPassword" | "newPassword",
        message: named.message,
      };
    // A server error may have gone through: say so, never "it failed".
    if (error.status >= 500)
      return {
        field: null,
        message:
          "We couldn't confirm that. Check your connection and try again.",
      };
    return { field: null, message: error.message };
  }
  return {
    field: null,
    message: "Couldn't change the password. Please try again.",
  };
}
