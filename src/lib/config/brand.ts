/**
 * Official brand assets. The HeavyCards logo must never be redrawn or
 * replaced (PROJECT.md §98).
 *
 * The mark is a single-colour SVG (`fill="currentColor"`). It is rendered as a
 * CSS mask filled with the current text colour (see `BrandMark`), so the same
 * file works on white and black surfaces without raster variants or filters.
 */
export type LogoAsset = Readonly<{
  src: string;
  /** Intrinsic viewBox size, used for the aspect ratio (no layout shift). */
  width: number;
  height: number;
}>;

export const brandAssets: Readonly<{ mark: LogoAsset }> = {
  mark: {
    src: "/brand/heavycards-mark.svg",
    width: 559,
    height: 684,
  },
};

/**
 * Raster renderings of the official mark (unchanged shape, generated from
 * heavycards-mark.svg with sharp), for places that cannot use the SVG mask:
 * - `share`: white mark on black, 1200×630, the default social-preview image
 *   for pages without product imagery (Open Graph);
 * - `logo`: black mark on white, 512×512, the Organization logo in
 *   structured data (search engines want a raster logo of at least 112 px).
 */
export const brandRasterAssets: Readonly<{
  share: LogoAsset;
  logo: LogoAsset;
}> = {
  share: { src: "/brand/heavycards-share.png", width: 1200, height: 630 },
  logo: { src: "/brand/heavycards-logo.png", width: 512, height: 512 },
};
