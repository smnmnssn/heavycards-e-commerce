import Image from "next/image";

import { GALLERY_SIZES, type GalleryImage } from "./gallery-shared";
import { ImagePlaceholder } from "./image-placeholder";
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

/** Square frame with the neutral placeholder while a product has no photos. */
export function ProductImagePlaceholder() {
  return (
    <div className="aspect-square">
      <ImagePlaceholder />
    </div>
  );
}
