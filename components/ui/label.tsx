"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
  {
    variants: {
      variant: {
        eyebrow:
          "block text-[11px] font-semibold uppercase tracking-[0.22em] text-clay",
        default:
          "flex items-center gap-2 text-sm leading-none font-medium",
      },
    },
    defaultVariants: {
      variant: "eyebrow",
    },
  }
)

export type LabelProps = React.ComponentProps<"label"> &
  VariantProps<typeof labelVariants>

function Label({ className, variant, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Label, labelVariants }
