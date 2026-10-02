"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

const RATINGS = [1, 2, 3, 4, 5] as const;

const ratingLabel = (rating: number) =>
  rating === 1 ? "1 stjärna av 5" : `${rating} stjärnor av 5`;

/**
 * 1–5 star rating as a native radio group (PROJECT.md §87: usable without
 * a mouse). Arrow keys move between stars, each star has a spoken label,
 * and the focused star gets a visible outline. Works without JavaScript as
 * a plain radio group; the hover preview is only an enhancement.
 */
export function RatingInput({
  name,
  legend,
  errorId,
  error,
}: {
  name: string;
  legend: string;
  errorId?: string;
  error?: string;
}) {
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState(0);
  const shown = preview || selected;

  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="text-sm font-semibold">{legend}</legend>
      <div
        className="mt-2 flex items-center gap-1"
        onMouseLeave={() => setPreview(0)}
      >
        {RATINGS.map((rating) => (
          <label
            key={rating}
            onMouseEnter={() => setPreview(rating)}
            className={cn(
              "relative flex size-11 cursor-pointer items-center justify-center rounded-md",
              "text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-0 has-focus-visible:outline-foreground",
            )}
          >
            {/* The real radio covers the whole 44 px star, invisibly. */}
            <input
              type="radio"
              name={name}
              value={rating}
              required
              checked={selected === rating}
              onChange={() => setSelected(rating)}
              className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-md outline-none"
            />
            <span className="sr-only">{ratingLabel(rating)}</span>
            {/* Outlined when empty, so every star keeps full contrast. */}
            <svg
              viewBox="0 0 20 20"
              fill={rating <= shown ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
              className="pointer-events-none size-7"
            >
              <path d="m10 1.5 2.6 5.5 6 .7-4.5 4.1 1.2 5.9L10 14.8l-5.3 2.9 1.2-5.9L1.4 7.7l6-.7L10 1.5Z" />
            </svg>
          </label>
        ))}
        <span className="ml-2 text-sm text-muted-foreground" aria-hidden="true">
          {selected ? `${selected} av 5` : "Välj betyg"}
        </span>
      </div>
    </fieldset>
  );
}
