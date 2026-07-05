"use client";

import { cn } from "@/lib/utils";

// Ultra-light precise arrow (↗) — no thick Lucide strokes.
export function ArrowUpRight({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 11 11 5" />
      <path d="M6 5h5v5" />
    </svg>
  );
}

export function CheckMini({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </svg>
  );
}

type Tone = "primary" | "neutral" | "destructive";

// The signature "island" pill: fully rounded, generous padding, and a nested
// trailing icon in its own circle that translates diagonally on hover
// (magnetic tension). Whole button presses in on :active. Custom cubic-bezier
// motion throughout — never linear.
export function IslandButton({
  children,
  className,
  tone = "primary",
  type = "button",
  disabled = false,
  onClick,
  icon,
  fullWidth = false,
  size = "md",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  /** trailing icon shown in the nested circle; defaults to the ↗ arrow */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const toneCls: Record<Tone, string> = {
    primary:
      "bg-primary text-primary-foreground hover:bg-primary shadow-[0_10px_30px_-12px_var(--primary)]",
    neutral:
      "bg-secondary text-secondary-foreground ring-1 ring-foreground/10 hover:bg-accent",
    destructive:
      "bg-transparent text-muted-foreground ring-1 ring-border hover:text-destructive hover:ring-destructive/40",
  };
  const circleCls: Record<Tone, string> = {
    primary: "bg-primary-foreground/15 text-primary-foreground",
    neutral: "bg-foreground/10 text-foreground",
    destructive: "bg-foreground/[0.06] text-current",
  };
  const pad = {
    sm: "py-1.5 pl-3.5 pr-1.5 text-[12.5px]",
    md: "py-2 pl-5 pr-2 text-sm",
    lg: "py-2.5 pl-6 pr-2.5 text-[15px]",
  }[size];
  const circleSize = { sm: "size-6", md: "size-7", lg: "size-9" }[size];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group/island relative inline-flex items-center justify-between gap-2.5 rounded-full font-medium",
        "transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        pad,
        toneCls[tone],
        fullWidth && "w-full",
        className,
      )}
    >
      <span className="whitespace-nowrap tracking-[0.01em]">{children}</span>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          "transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "group-hover/island:translate-x-0.5 group-hover/island:-translate-y-px group-hover/island:scale-105",
          circleSize,
          circleCls[tone],
        )}
      >
        {icon ?? <ArrowUpRight />}
      </span>
    </button>
  );
}
