"use client";

import { useId } from "react";

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
      <input
        id={inputId}
        className={cn(resolvedInputClassName, "w-[160px]")}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value ?? ""}
        placeholder="Tap to set"
        onChange={(event) => {
          const raw = event.target.value;
          const cleaned = raw.replace(/[^\d.]/g, "");
          const parts = cleaned.split(".");
          const normalized =
            parts.length <= 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join("")}`;
          onChange(normalized);
        }}
        aria-label={label}
        disabled={disabled}
      />
    </div>
  );
}
