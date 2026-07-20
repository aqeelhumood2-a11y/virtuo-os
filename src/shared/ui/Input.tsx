import { type InputHTMLAttributes, forwardRef } from "react";

import { cn } from "@/shared/utils/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
          "disabled:pointer-events-none disabled:opacity-50",
          invalid && "border-red-500 focus-visible:ring-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
