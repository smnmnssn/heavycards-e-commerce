import Image from "next/image";
import Link from "next/link";

import { brandAssets } from "@/lib/config/brand";
import { siteConfig } from "@/lib/config/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Rendered height in px; width follows the asset's aspect ratio. */
  height?: number;
};

/**
 * The HeavyCards logo, linking to the homepage.
 *
 * Uses the official asset from `brandAssets` when configured. Until the real
 * file is supplied, a plain text wordmark stands in. It is deliberately not a
 * redrawn or invented logo (PROJECT.md §98).
 */
export function Logo({ className, height = 28 }: LogoProps) {
  const { logo } = brandAssets;

  return (
    <Link
      href="/"
      aria-label={`${siteConfig.brandName} – till startsidan`}
      className={cn("inline-flex items-center", className)}
    >
      {logo ? (
        <Image
          src={logo.src}
          alt=""
          width={Math.round((logo.width / logo.height) * height)}
          height={height}
          priority
        />
      ) : (
        <span
          aria-hidden="true"
          className="text-[1.0625rem] leading-none font-extrabold tracking-[0.04em] uppercase [font-stretch:125%] sm:text-lg"
        >
          {siteConfig.brandName}
        </span>
      )}
    </Link>
  );
}
