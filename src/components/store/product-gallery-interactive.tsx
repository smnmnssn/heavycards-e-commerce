"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

import {
  GALLERY_SIZES,
  MAIN_IMAGE_LOADING,
  type GalleryImage,
} from "./gallery-shared";

/** Main image plus thumbnail buttons; only used with two or more images. */
export function ProductGalleryInteractive({
  images,
}: {
  images: readonly GalleryImage[];
}) {
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? images[0]!;

  return (
    <div>
      <div className="relative aspect-square overflow-hidden bg-surface">
        <Image
          key={current.id}
          src={current.src}
          alt={current.alt}
          width={current.width}
          height={current.height}
          sizes={GALLERY_SIZES}
          {...(selected === 0 ? MAIN_IMAGE_LOADING : {})}
          className="size-full object-contain p-[6%]"
        />
      </div>
      <ul className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              aria-label={`Visa bild ${index + 1} av ${images.length}`}
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              className={cn(
                "relative block aspect-square w-full overflow-hidden border bg-surface transition-colors",
                index === selected
                  ? "border-foreground"
                  : "border-transparent hover:border-input",
              )}
            >
              <Image
                src={image.src}
                alt=""
                width={image.width}
                height={image.height}
                sizes="20vw"
                className="size-full object-contain p-[8%]"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
