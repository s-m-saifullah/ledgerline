import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export { cn } from "./cn";
export * from "./pieces";
export function Button({
  className,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn("button", className)} {...props} />;
}
