import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "success-locked";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-card transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "border border-border bg-white text-muted transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "border border-transparent bg-transparent text-muted transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60",
  // Locked confirmation state (e.g. "✓ Approved" on an output).
  "success-locked": "border border-[#BFE3CD] bg-[#E7F4EC] text-[#1E7A47] cursor-default",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "rounded-md px-3 py-2 font-sans text-[12.5px] font-semibold",
  md: "rounded-[10px] px-[15px] py-[9px] font-sans text-[13.5px] font-semibold",
  lg: "rounded-xl px-4 py-[14px] font-sans text-[15px] font-semibold",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", leadingIcon, trailingIcon, className, children, ...rest },
  ref,
) {
  const cls = [
    "inline-flex items-center justify-center gap-[7px] whitespace-nowrap",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} className={cls} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});
