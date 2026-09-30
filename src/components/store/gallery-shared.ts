/** Shared by the server gallery and its client-side interactive variant. */
export type GalleryImage = {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
};

export const GALLERY_SIZES = "(min-width: 64rem) 50vw, 100vw";
