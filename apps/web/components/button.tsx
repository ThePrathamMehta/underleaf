"use client";

import Link from "next/link";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-accent-hover active:translate-y-px",
  secondary:
    "bg-paper-raised text-ink ring-1 ring-inset ring-rule-strong hover:bg-paper-sunken active:translate-y-px",
  ghost: "text-ink-muted hover:bg-paper-sunken hover:text-ink",
  danger: "bg-danger-wash text-danger ring-1 ring-inset ring-danger/20 hover:bg-danger hover:text-white",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[0.9375rem]",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 " +
  "disabled:pointer-events-none disabled:opacity-50";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref,
) {
  return <button ref={ref} className={buttonClass(variant, size, className)} {...props} />;
});

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({ variant = "primary", size = "md", className = "", ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
