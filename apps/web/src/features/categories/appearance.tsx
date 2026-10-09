import {
  Banknote,
  Briefcase,
  Bus,
  Car,
  Circle,
  Coffee,
  Ellipsis,
  Gift,
  GraduationCap,
  Heart,
  House,
  Percent,
  Plus,
  ShoppingBag,
  Smartphone,
  Users,
  Utensils,
  Wallet,
} from "lucide-react";
export const categoryIcons = {
  circle: { label: "Circle", icon: Circle },
  utensils: { label: "Food", icon: Utensils },
  house: { label: "Home", icon: House },
  bus: { label: "Transport", icon: Bus },
  heart: { label: "Health", icon: Heart },
  briefcase: { label: "Work", icon: Briefcase },
  "shopping-bag": { label: "Shopping", icon: ShoppingBag },
  coffee: { label: "Coffee", icon: Coffee },
  gift: { label: "Gift", icon: Gift },
  "graduation-cap": { label: "Learning", icon: GraduationCap },
  wallet: { label: "Wallet", icon: Wallet },
  plus: { label: "Plus", icon: Plus },
  ellipsis: { label: "Other", icon: Ellipsis },
  car: { label: "Car", icon: Car },
  percent: { label: "Rewards", icon: Percent },
  smartphone: { label: "Phone", icon: Smartphone },
  banknote: { label: "Money", icon: Banknote },
  users: { label: "Family", icon: Users },
};
export const categoryColors = [
  { value: "#0D9488", label: "Teal" },
  { value: "#0891B2", label: "Cyan" },
  { value: "#2563EB", label: "Blue" },
  { value: "#7C3AED", label: "Violet" },
  { value: "#A16207", label: "Ochre" },
  { value: "#0F766E", label: "Forest" },
  { value: "#64748B", label: "Slate" },
  { value: "#9333EA", label: "Purple" },
];
export function CategoryMark({
  icon,
  color,
}: {
  icon: string | null;
  color: string | null;
}) {
  const Icon =
    icon && Object.hasOwn(categoryIcons, icon)
      ? categoryIcons[icon as keyof typeof categoryIcons].icon
      : Circle;
  // Color is a decorative swatch; text/icons always use theme contrast tokens.
  return (
    <span className="category-mark" aria-hidden="true">
      <Icon size={20} />
      <span
        className="category-swatch"
        style={{ backgroundColor: color ?? "var(--muted)" }}
      />
    </span>
  );
}
