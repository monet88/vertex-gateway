import { cva } from "class-variance-authority"

export const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--operator-teal)] text-[#003731] shadow hover:bg-[var(--operator-teal)]/80",
        secondary:
          "border-transparent bg-[var(--console-surface-high)] text-[var(--console-ink)] hover:bg-[var(--console-surface-high)]/80",
        destructive:
          "border-transparent bg-[var(--failure-red)] text-white shadow hover:bg-[var(--failure-red)]/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)
