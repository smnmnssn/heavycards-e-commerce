import Image from "next/image";

import { siteConfig } from "@/lib/config/site";

import { GALLERY_SIZES, type GalleryImage } from "./gallery-shared";
import { ProductGalleryInteractive } from "./product-gallery-interactive";

/**
 * Product images in a fixed square frame, so the page never shifts while
 * images load. Zero or one image renders on the server; only a real
 * multi-image gallery ships the small client component.
 */
export function ProductGallery({
  images,
}: {
  images: readonly GalleryImage[];
}) {
  if (images.length === 0) {
    return <ProductImagePlaceholder />;
  }
  if (images.length === 1) {
    const image = images[0]!;
    return (
      <div className="relative aspect-square overflow-hidden bg-surface">
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          sizes={GALLERY_SIZES}
          priority
          className="size-full object-contain p-[6%]"
        />
      </div>
    );
  }
  return <ProductGalleryInteractive images={images} />;
}

/**
 * Neutral stand-in until product photos exist (image upload arrives in
 * Milestone 7). Decorative: the product name is already the page heading.
 */
export function ProductImagePlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-square items-center justify-center bg-surface"
    >
      <span className="text-sm font-bold tracking-[0.3em] text-muted-foreground uppercase [font-stretch:125%] sm:text-base">
        {siteConfig.brandName}
      </span>
    </div>
  );
}
