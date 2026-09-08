"use client";

import { useId, type ComponentProps } from "react";

export function Input({
  label,
  hint,
  error,
  id,
  className = "",
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptions = [
    describedBy,
    hint && `${inputId}-hint`,
    error && `${inputId}-error`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={inputId}
        className={`input ${className}`}
        aria-describedby={descriptions || undefined}
        aria-invalid={error ? true : invalid}
        {...props}
      />
      {hint && (
        <p className="field-hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${inputId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
