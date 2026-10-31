import { type Category, createCategorySchema } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ComboCreate } from "../../components/combo-field";
import { ApiError } from "../../lib/api";
import { prepareCategorySave } from "./api";

/**
 * "Create <kind> category “name”" as a suggestion in a category field. It saves a top-level category of that kind
 * and hands back its id. An answer that never came (offline, a server error) keeps the very same request, so
 * choosing the suggestion again replays it with the same key rather than making a second category; `uncertain`
 * says one is waiting, so a form can hold its own save until it is settled.
 */
export function useCategoryCreate(
  ledgerId: string,
  kind: Category["kind"],
  onCreated?: (category: Category) => void,
) {
  const client = useQueryClient();
  const attempt = useRef<{
    name: string;
    run: () => Promise<Category>;
  } | null>(null);
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const create: ComboCreate = {
    key: kind,
    label: (text) => `Create ${kind} category “${text}”`,
    run: async (name) => {
      if (inFlight.current)
        throw new Error("Wait for the category to finish saving.");
      if (!attempt.current) {
        const parsed = createCategorySchema.safeParse({
          name,
          kind,
          parentId: null,
          icon: null,
          color: null,
        });
        if (!parsed.success)
          throw new Error("Give the category a name of 1–100 characters.");
        attempt.current = {
          name,
          run: prepareCategorySave(ledgerId, undefined, parsed.data),
        };
      } else if (attempt.current.name !== name) {
        throw new Error(
          `Confirm “${attempt.current.name}” first: choose it again.`,
        );
      }
      inFlight.current = true;
      try {
        const made = await attempt.current.run();
        attempt.current = null;
        setUncertain(false);
        client.setQueryData<Category[]>(["categories", ledgerId], (items) => [
          ...(items ?? []).filter((row) => row.id !== made.id),
          made,
        ]);
        void client.invalidateQueries({ queryKey: ["categories", ledgerId] });
        void client.invalidateQueries({ queryKey: ["home", ledgerId] });
        onCreated?.(made);
        return made.id;
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.status >= 500) {
          setUncertain(true);
          throw new Error(
            "We couldn't confirm the category. Choose it again to retry.",
          );
        }
        attempt.current = null;
        setUncertain(false);
        throw new Error(failure.message);
      } finally {
        inFlight.current = false;
      }
    },
  };
  return { create, uncertain };
}
