import Link from "next/link";

import { siteConfig } from "@/lib/config/site";
import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";

/**
 * The HeavyCards logo (official mark), linking to the homepage. It inherits
 * the text colour, so it adapts to light and inverted surfaces.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label={`${siteConfig.brandName} – till startsidan`}
      className={cn("inline-flex items-center py-1", className)}
    >
      <BrandMark className="h-9 lg:h-10" />
    </Link>
  );
}
