"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";

import { MinusIcon, PlusIcon } from "./icons";

/**
 * Accessible quantity control: labelled −/+ buttons around a numeric input.
 * Typed values are committed on blur or Enter and clamped to [min, max], so
 * the value handed to `onChange` is always valid.
 */
export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  size = "md",
  disabled = false,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  /** Accessible name, e.g. "Antal" or "Antal för Destined Rivals ETB". */
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(parsed) && clamp(parsed) !== value) {
      onChange(clamp(parsed));
    }
  };

  const buttonClass = cn(
    "inline-flex shrink-0 items-center justify-center text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
    size === "md" ? "size-12" : "size-11",
  );

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center border border-input",
        disabled && "opacity-50",
      )}
    >
      <button
        type="button"
        aria-label="Minska antal"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className={buttonClass}
      >
        <MinusIcon className="size-4" />
      </button>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        className={cn(
          "w-10 [appearance:textfield] bg-transparent text-center text-base font-semibold tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          size === "md" ? "h-12" : "h-11",
        )}
      />
      <button
        type="button"
        aria-label="Öka antal"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className={buttonClass}
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
