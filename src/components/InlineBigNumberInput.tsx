"use client";

import { useEffect, useId, useRef, useState } from "react";

const cn = (...values: Array<string | undefined>) =>
  values.filter(Boolean).join(" ");

type InlineBigNumberInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
};

export default function InlineBigNumberInput({
  label,
  value,
  onChange,
  disabled = false,
  className,
  labelClassName,
  inputClassName,
}: InlineBigNumberInputProps) {
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const displayValue = value && value.trim() ? value : "Tap to set";
  const containerClassName = className
    ? `stack ${className}`
    : "stack items-center";
  const resolvedLabelClassName = cn("text-lg font-semibold", labelClassName);
  const resolvedInputClassName = cn(
    "input",
    "text-3xl font-bold tabular-nums text-center",
    inputClassName
  );

  return (
    <div className={containerClassName}>
      <label className={resolvedLabelClassName} htmlFor={inputId}>
        {label}
      </label>
      {isEditing && !disabled ? (
        <input
          ref={inputRef}
          id={inputId}
          className={cn(resolvedInputClassName, "w-[160px]")}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label={label}
        />
      ) : (
        <button
          type="button"
          className={cn(
            "min-w-[140px] rounded-2xl border border-[var(--edge)] bg-white/70 px-4 py-2",
            resolvedInputClassName
          )}
          onClick={() => {
            if (!disabled) setIsEditing(true);
          }}
          aria-label={label}
        >
          {displayValue}
        </button>
      )}
    </div>
  );
}
