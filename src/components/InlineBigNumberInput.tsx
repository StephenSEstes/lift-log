"use client";

import { useEffect, useId, useRef, useState } from "react";

type InlineBigNumberInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export default function InlineBigNumberInput({
  label,
  value,
  onChange,
  disabled = false,
  className,
}: InlineBigNumberInputProps) {
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const displayValue = value ? value : "--";
  const containerClassName = className ? `stack ${className}` : "stack";

  return (
    <div className={containerClassName}>
      <label className="text-lg font-medium" htmlFor={inputId}>
        {label}
      </label>
      {isEditing && !disabled ? (
        <input
          ref={inputRef}
          id={inputId}
          className="input input--inline text-3xl font-semibold"
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
          className="text-3xl font-semibold"
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
