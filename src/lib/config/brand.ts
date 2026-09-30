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
