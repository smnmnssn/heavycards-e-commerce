import { brandAssets } from "@/lib/config/brand";
import { cn } from "@/lib/utils";

/**
 * The official HeavyCards mark, drawn from the single SVG file as a CSS mask
 * filled with `currentColor`: black on light surfaces, white on
 * `.surface-inverted`, muted inside placeholders. Size it with a height class;
 * the width follows the mark's intrinsic aspect ratio.
 *
 * Decorative by default. Callers provide the accessible name (e.g. the logo
 * link's `aria-label`).
 */
export function BrandMark({ className }: { className?: string }) {
  const { src, width, height } = brandAssets.mark;
  const mask = `url("${src}") center / contain no-repeat`;

  return (
    <span
      aria-hidden="true"
      className={cn("brand-mark inline-block shrink-0 bg-current", className)}
      style={{
        aspectRatio: `${width} / ${height}`,
        mask,
        WebkitMask: mask,
      }}
    />
  );
}
