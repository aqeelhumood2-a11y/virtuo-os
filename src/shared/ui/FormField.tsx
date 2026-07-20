"use client";

import { type ReactElement, cloneElement, useId } from "react";

import { cn } from "@/shared/utils/cn";

export type FormFieldProps = {
  label: string;
  error?: string;
  className?: string;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    invalid?: boolean;
  }>;
};

export function FormField({ label, error, className, children }: FormFieldProps) {
  const inputId = useId();
  const errorId = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-900">
        {label}
      </label>
      {cloneElement(children, {
        id: inputId,
        "aria-describedby": error ? errorId : undefined,
        invalid: Boolean(error),
      })}
      {error ? (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
