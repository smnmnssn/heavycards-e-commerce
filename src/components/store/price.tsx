import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * VAT-inclusive price. A compare-at price is only shown when it is higher,
 * mirroring the database rule, and is announced as the previous price rather
 * than relying on the strikethrough alone.
 */
export function Price({
  amount,
  compareAtAmount,
  className,
}: {
  amount: number;
  compareAtAmount?: number | null;
  className?: string;
}) {
  const onSale = compareAtAmount != null && compareAtAmount > amount;

  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 tabular-nums",
        className,
      )}
    >
      {onSale && <span className="sr-only">Nu</span>}
      <span className="font-semibold">{formatPrice(amount)}</span>
      {onSale && (
        <>
          <span className="sr-only">, tidigare</span>
          <s className="text-sm text-muted-foreground">
            {formatPrice(compareAtAmount)}
          </s>
        </>
      )}
    </p>
  );
}
