import { type HTMLAttributes, forwardRef } from "react";

import { cn } from "@/shared/utils/cn";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-neutral-200 bg-white p-6 shadow-sm",
        className,
      )}
      {...props}
    />
  );
});

Card.displayName = "Card";
