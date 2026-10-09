import { z } from "zod";
import { idSchema, ledgerParamsSchema, versionSchema } from "./contracts";

export const categoryKindSchema = z.enum(["income", "expense"]);
const nameSchema = z.string().trim().min(1).max(100);
// Lucide icon names, never markup or arbitrary URLs.
const iconSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,49}$/)
  .nullable();
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();
export const createCategorySchema = z.strictObject({
  name: nameSchema,
  kind: categoryKindSchema,
  parentId: idSchema.nullable().default(null),
  icon: iconSchema.default(null),
  color: colorSchema.default(null),
});
export const updateCategorySchema = z
  .strictObject({
    expectedVersion: versionSchema,
    name: nameSchema.optional(),
    parentId: idSchema.nullable().optional(),
    icon: iconSchema.optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (body) =>
      [body.name, body.parentId, body.icon, body.color].some(
        (value) => value !== undefined,
      ),
    "Provide a category field to update.",
  );
export const archiveCategorySchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const unarchiveCategorySchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const categoryParamsSchema = ledgerParamsSchema.extend({
  categoryId: idSchema,
});
export const categoryListQuerySchema = z.object({
  status: z.enum(["all", "active", "archived"]).default("all"),
  kind: categoryKindSchema.optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const categorySchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  name: nameSchema,
  kind: categoryKindSchema,
  parentId: idSchema.nullable(),
  icon: iconSchema,
  color: colorSchema,
  sortOrder: z.number().int().min(0).max(2_147_483_647),
  archivedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const categoryListSchema = z.object({
  items: z.array(categorySchema),
  nextCursor: idSchema.nullable(),
});
export const categoryBatchSchema = z.object({ items: z.array(categorySchema) });
export const reorderCategoriesSchema = z
  .strictObject({
    kind: categoryKindSchema,
    parentId: idSchema.nullable().default(null),
    items: z
      .array(z.strictObject({ id: idSchema, expectedVersion: versionSchema }))
      .min(1)
      .max(1000),
  })
  .refine(
    (body) =>
      new Set(body.items.map((item) => item.id.toLowerCase())).size ===
      body.items.length,
    "Provide each category once.",
  );
/** Groups of the default starter set a client can include; ordering follows the preview. */
export const defaultStarterGroupKeys = [
  "salary",
  "business",
  "investments",
  "gifts-received",
  "refunds",
  "other-income",
  "housing",
  "food",
  "transport",
  "utilities",
  "subscriptions",
  "health",
  "shopping",
  "entertainment",
  "education",
  "family-gifts",
  "fees-interest",
  "other-expenses",
] as const;
/** Optional add-on groups; never created unless a client names them. */
export const starterAddOnGroupKeys = [
  "student-income",
  "gig-income",
  "students",
  "shared-household",
  "gig-costs",
  "support-abroad",
] as const;
export const starterGroupKeys = [
  ...defaultStarterGroupKeys,
  ...starterAddOnGroupKeys,
] as const;
export type DefaultStarterGroupKey = (typeof defaultStarterGroupKeys)[number];
export type StarterAddOnGroupKey = (typeof starterAddOnGroupKeys)[number];
export type StarterGroupKey = (typeof starterGroupKeys)[number];
/**
 * "basic" is the seven-root set. "default" is the two-level starter set; "personal" is its
 * original API name, kept so replayed requests and older clients keep working.
 */
export const createCategoryStarterSetSchema = z
  .strictObject({
    starterSet: z.enum(["basic", "default", "personal"]),
    // Two-level set only: the groups to create. Omitted means every default group (no add-ons).
    groups: z
      .array(z.enum(starterGroupKeys))
      .min(1)
      .max(starterGroupKeys.length)
      .optional(),
  })
  .refine(
    (body) =>
      (body.groups === undefined || body.starterSet !== "basic") &&
      new Set(body.groups).size === (body.groups?.length ?? 0),
    "Choose each starter group once, and only for the default set.",
  );
// Previewable by clients; creating this set always requires an explicit API action.
export const basicCategoryStarterSet: readonly z.input<
  typeof createCategorySchema
>[] = [
  { name: "Salary", kind: "income", icon: "briefcase", color: "#0D9488" },
  { name: "Other income", kind: "income", icon: "plus", color: "#0891B2" },
  { name: "Food", kind: "expense", icon: "utensils", color: "#A16207" },
  { name: "Housing", kind: "expense", icon: "house", color: "#7C3AED" },
  { name: "Transport", kind: "expense", icon: "bus", color: "#2563EB" },
  { name: "Health", kind: "expense", icon: "heart", color: "#0F766E" },
  {
    name: "Other expenses",
    kind: "expense",
    icon: "ellipsis",
    color: "#64748B",
  },
];
export type StarterGroup<Key extends StarterGroupKey = StarterGroupKey> = {
  key: Key;
  name: string;
  kind: "income" | "expense";
  icon: string;
  color: string;
  /** Child categories (second level) created under the group; empty for a single top-level category. */
  children: readonly string[];
};
// Previewable by clients; creating any of this always requires an explicit API action. Categories only, never accounts.
export const defaultCategoryStarterSet: readonly StarterGroup<DefaultStarterGroupKey>[] =
  [
    {
      key: "salary",
      name: "Salary & wages",
      kind: "income",
      icon: "briefcase",
      color: "#0D9488",
      children: ["Salary", "Hourly wages", "Bonus"],
    },
    {
      key: "business",
      name: "Business & side income",
      kind: "income",
      icon: "wallet",
      color: "#0891B2",
      children: [],
    },
    {
      key: "investments",
      name: "Interest & investments",
      kind: "income",
      icon: "percent",
      color: "#0F766E",
      children: [],
    },
    {
      key: "gifts-received",
      name: "Gifts received",
      kind: "income",
      icon: "gift",
      color: "#9333EA",
      children: [],
    },
    {
      key: "refunds",
      name: "Refunds & reimbursements",
      kind: "income",
      icon: "banknote",
      color: "#2563EB",
      children: [],
    },
    {
      key: "other-income",
      name: "Other income",
      kind: "income",
      icon: "plus",
      color: "#64748B",
      children: [],
    },
    {
      key: "housing",
      name: "Housing",
      kind: "expense",
      icon: "house",
      color: "#7C3AED",
      children: ["Rent or mortgage", "Home maintenance", "Home insurance"],
    },
    {
      key: "food",
      name: "Food",
      kind: "expense",
      icon: "utensils",
      color: "#A16207",
      children: ["Groceries", "Dining out", "Coffee & snacks"],
    },
    {
      key: "transport",
      name: "Transport",
      kind: "expense",
      icon: "bus",
      color: "#2563EB",
      children: ["Fuel", "Public transport", "Car costs"],
    },
    {
      key: "utilities",
      name: "Utilities & phone",
      kind: "expense",
      icon: "smartphone",
      color: "#0891B2",
      children: ["Electricity & water", "Internet", "Mobile phone"],
    },
    {
      key: "subscriptions",
      name: "Subscriptions",
      kind: "expense",
      icon: "circle",
      color: "#9333EA",
      children: [],
    },
    {
      key: "health",
      name: "Health",
      kind: "expense",
      icon: "heart",
      color: "#0F766E",
      children: ["Doctor & medicine", "Insurance"],
    },
    {
      key: "shopping",
      name: "Shopping & clothing",
      kind: "expense",
      icon: "shopping-bag",
      color: "#7C3AED",
      children: [],
    },
    {
      key: "entertainment",
      name: "Entertainment",
      kind: "expense",
      icon: "coffee",
      color: "#A16207",
      children: [],
    },
    {
      key: "education",
      name: "Education",
      kind: "expense",
      icon: "graduation-cap",
      color: "#2563EB",
      children: [],
    },
    {
      key: "family-gifts",
      name: "Family & gifts",
      kind: "expense",
      icon: "users",
      color: "#0D9488",
      children: ["Gifts given", "Family support"],
    },
    {
      key: "fees-interest",
      name: "Fees & interest",
      kind: "expense",
      icon: "banknote",
      color: "#64748B",
      children: [],
    },
    {
      key: "other-expenses",
      name: "Other expenses",
      kind: "expense",
      icon: "ellipsis",
      color: "#64748B",
      children: [],
    },
  ];
// Optional extras for particular situations; off by default in every client.
export const categoryStarterAddOns: readonly StarterGroup<StarterAddOnGroupKey>[] =
  [
    {
      key: "student-income",
      name: "Scholarship & stipend",
      kind: "income",
      icon: "graduation-cap",
      color: "#2563EB",
      children: ["Scholarship", "Stipend or assistantship pay"],
    },
    {
      key: "gig-income",
      name: "Gig & hourly earnings",
      kind: "income",
      icon: "car",
      color: "#0891B2",
      children: ["Ride or delivery earnings", "Tips"],
    },
    {
      key: "students",
      name: "Student costs",
      kind: "expense",
      icon: "graduation-cap",
      color: "#0D9488",
      children: ["Tuition & fees", "Books & supplies"],
    },
    {
      key: "shared-household",
      name: "Shared household",
      kind: "expense",
      icon: "users",
      color: "#7C3AED",
      children: ["Rent share", "Shared groceries", "Shared utilities"],
    },
    {
      key: "gig-costs",
      name: "Gig work costs",
      kind: "expense",
      icon: "car",
      color: "#A16207",
      children: ["Vehicle costs", "Equipment & supplies"],
    },
    {
      key: "support-abroad",
      name: "Sending money abroad",
      kind: "expense",
      icon: "wallet",
      color: "#0F766E",
      children: ["Support for family", "Transfer fees"],
    },
  ];
/** Every starter group in preview order: default groups, then add-ons. */
export const categoryStarterGroups: readonly StarterGroup[] = [
  ...defaultCategoryStarterSet,
  ...categoryStarterAddOns,
];
export type Category = z.infer<typeof categorySchema>;
export type CreateCategory = z.infer<typeof createCategorySchema>;
export type UpdateCategory = z.infer<typeof updateCategorySchema>;
export type ArchiveCategory = z.infer<typeof archiveCategorySchema>;
export type UnarchiveCategory = z.infer<typeof unarchiveCategorySchema>;
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
export type ReorderCategories = z.infer<typeof reorderCategoriesSchema>;
export type CreateCategoryStarterSet = z.infer<
  typeof createCategoryStarterSetSchema
>;

export const deleteCategorySchema = z.strictObject({
  expectedVersion: versionSchema,
});
export type DeleteCategory = z.infer<typeof deleteCategorySchema>;

const mergeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const categoryMergeSummarySchema = z.object({
  ordinaryCleared: mergeCount,
  ordinaryPending: mergeCount,
  splitLines: mergeCount,
  splitParents: mergeCount,
  linkedPayments: mergeCount,
  receivables: mergeCount,
  children: z.array(categorySchema),
  excludedTransactions: mergeCount,
  excludedSplitLines: mergeCount,
  excludedPayments: mergeCount,
  excludedChildren: mergeCount,
});
export const categoryMergePreviewQuerySchema = z.strictObject({
  destinationCategoryId: idSchema,
});
export const categoryMergeSchema = z.strictObject({
  destinationCategoryId: idSchema,
  expectedSourceVersion: versionSchema,
  expectedDestinationVersion: versionSchema,
  previewToken: z.string().regex(/^[0-9a-f]{64}$/),
});
export const categoryMergePreviewSchema = z
  .object({
    source: categorySchema,
    destination: categorySchema,
    canMerge: z.boolean(),
    blockers: z.array(z.object({ code: z.string(), message: z.string() })),
    summary: categoryMergeSummarySchema,
    expectedSourceVersion: versionSchema,
    expectedDestinationVersion: versionSchema,
    previewToken: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .refine(
    (value) => value.canMerge === (value.previewToken !== null),
    "Only eligible previews have a confirmation token.",
  );
export const categoryMergeResultSchema = z.object({
  source: categorySchema,
  destination: categorySchema,
  summary: categoryMergeSummarySchema,
});
export type CategoryMerge = z.infer<typeof categoryMergeSchema>;
export type CategoryMergePreview = z.infer<typeof categoryMergePreviewSchema>;
export type CategoryMergeResult = z.infer<typeof categoryMergeResultSchema>;
