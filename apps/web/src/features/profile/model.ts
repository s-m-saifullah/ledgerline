/** What the Profile page asks of a name and a password, and how the server's answers land on the rows (ADR 0048). */
export const nameMessage = "Use 1 to 100 characters.";
export const parseName = (raw: string) => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
};
