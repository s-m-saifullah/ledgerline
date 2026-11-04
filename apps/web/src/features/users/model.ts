import type { ManagedUser } from "@ledgerline/shared";
import type { PillTone } from "@ledgerline/ui";

/** What the Users page says and decides (ADR 0048), apart from how it looks. */

/** 128 short words, so a word is seven random bits; three of them and a four-digit number make a password of about 34 bits. */
export const passwordWords = [
  "amber",
  "anchor",
  "apple",
  "arrow",
  "aspen",
  "autumn",
  "badger",
  "basil",
  "beacon",
  "birch",
  "bison",
  "breeze",
  "bridge",
  "brook",
  "cactus",
  "candle",
  "canyon",
  "cedar",
  "cherry",
  "cinder",
  "clover",
  "cobalt",
  "comet",
  "copper",
  "coral",
  "cricket",
  "daisy",
  "delta",
  "dune",
  "eagle",
  "ember",
  "falcon",
  "fern",
  "finch",
  "fjord",
  "flint",
  "forest",
  "fox",
  "garnet",
  "ginger",
  "glacier",
  "granite",
  "grove",
  "harbor",
  "hazel",
  "heron",
  "hollow",
  "indigo",
  "iris",
  "island",
  "ivory",
  "jasper",
  "juniper",
  "kettle",
  "lagoon",
  "lantern",
  "laurel",
  "lemon",
  "lilac",
  "lotus",
  "lunar",
  "maple",
  "marble",
  "meadow",
  "mist",
  "moss",
  "nectar",
  "nutmeg",
  "oak",
  "olive",
  "onyx",
  "orchid",
  "otter",
  "pearl",
  "pebble",
  "pine",
  "plum",
  "pond",
  "poppy",
  "prairie",
  "quartz",
  "quill",
  "raven",
  "reed",
  "ridge",
  "river",
  "robin",
  "saffron",
  "sage",
  "sierra",
  "silver",
  "slate",
  "sparrow",
  "spruce",
  "summit",
  "sunset",
  "swan",
  "thistle",
  "thyme",
  "tide",
  "timber",
  "topaz",
  "tulip",
  "tundra",
  "valley",
  "velvet",
  "violet",
  "walnut",
  "willow",
  "wren",
  "yarrow",
  "zephyr",
  "acorn",
  "bamboo",
  "cypress",
  "dawn",
  "elm",
  "frost",
  "gull",
  "jade",
  "kelp",
  "magnet",
  "mango",
  "mosaic",
  "peach",
  "rowan",
  "tiger",
  "walrus",
] as const;

type Fill = (array: Uint32Array) => Uint32Array;
const browserFill: Fill = (array) => crypto.getRandomValues(array);

/** A whole number from 0 to `limit - 1`, every one equally likely: a draw from the uneven tail is thrown away. */
function below(limit: number, fill: Fill) {
  const fair = Math.floor(2 ** 32 / limit) * limit;
  const draw = new Uint32Array(1);
  for (;;) {
    const value = fill(draw)[0] as number;
    if (value < fair) return value % limit;
  }
}

/** The temporary password for a new person or a reset: three words and a number, made in the browser (never by the server). */
export function makeTemporaryPassword(fill: Fill = browserFill) {
  const word = () => passwordWords[below(passwordWords.length, fill)];
  const first = word();
  const second = word();
  const number = 1000 + below(9000, fill);
  return `${first}-${second}-${number}-${word()}`;
}

/** The one pill of a row, if there is something to say: the admin, a stopped sign-in, or a password still to be changed. */
export function userPill(
  person: ManagedUser,
): { text: string; tone: PillTone } | null {
  if (person.isAdmin) return { text: "Admin", tone: "accent" };
  if (person.disabled) return { text: "Disabled", tone: "neutral" };
  if (person.mustChangePassword)
    return { text: "Temporary password", tone: "warning" };
  return null;
}

export const userHint = (person: ManagedUser) => person.email;

/** The first word of a name, for sentences like "Riley can sign in"; "They" when there is no name. */
export const firstName = (name: string) =>
  name.trim().split(/\s+/)[0] || "They";

/** Delete asks for the person's email; case and spaces around it do not matter. */
export const deleteConfirmed = (email: string, typed: string) =>
  typed.trim().toLowerCase() === email.toLowerCase();
