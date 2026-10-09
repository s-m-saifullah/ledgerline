# ADR 0014: Delete actions are red

Date: 2026-10-08. Status: accepted, requested by the owner.

Every control that deletes something (Delete buttons, delete menu items, delete icons and the confirmation button of a delete dialog) is red, so destructive actions are recognisable at a glance. This widens the earlier rule "red only for overspending and errors" to "overspending, errors and Delete actions". Archive, write-off and other reversible or non-deleting actions stay neutral.

Implementation: a shared `danger-action` class with a `--danger-foreground` token for readable text on a red button in light and dark themes. Colour is never the only cue; labels and icons stay.
