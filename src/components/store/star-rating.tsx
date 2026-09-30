import { cn } from "@/lib/utils";

const ratingFormatter = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatRating(rating: number): string {
  return ratingFormatter.format(rating);
}

/**
 * Five monochrome stars filled to the exact rating. The stars are
 * decorative; the accessible text states the rating in words.
 */
export function StarRating({
  rating,
  className,
  size = "md",
}: {
  rating: number;
  className?: string;
  size?: "sm" | "md";
}) {
  const clamped = Math.min(5, Math.max(0, rating));
  const star = size === "sm" ? "size-3.5" : "size-4.5";

  return (
    <span className={cn("inline-flex items-center", className)}>
      <span className="sr-only">Betyg {formatRating(clamped)} av 5</span>
      <span aria-hidden="true" className="relative inline-flex">
        <Stars className={cn(star, "text-border")} />
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          <Stars className={cn(star, "text-foreground")} />
        </span>
      </span>
    </span>
  );
}

function Stars({ className }: { className: string }) {
  return (
    <span className="inline-flex gap-0.5 whitespace-nowrap">
      {[0, 1, 2, 3, 4].map((index) => (
        <svg
          key={index}
          viewBox="0 0 20 20"
          fill="currentColor"
          className={cn("shrink-0", className)}
          focusable="false"
        >
          <path d="m10 1.5 2.6 5.5 6 .7-4.5 4.1 1.2 5.9L10 14.8l-5.3 2.9 1.2-5.9L1.4 7.7l6-.7L10 1.5Z" />
        </svg>
      ))}
    </span>
  );
}
