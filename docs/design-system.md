# Design system

The storefront design foundation (Milestone 3). Brand direction (PROJECT.md
§7): premium, minimalist and monochrome. The site chrome is black, white and
grey, so that product photography supplies the colour.

Tokens and typography roles live in [src/app/globals.css](../src/app/globals.css).
Primitives live in `src/components/ui`, storefront components in
`src/components/store`. In development, `/designsystem` renders everything
(it returns 404 in production).

## Principles

- **Restraint.** No accent colour, gradients, glows or rounded "SaaS" cards.
  Emphasis comes from type weight, scale and black/white inversion.
- **Square geometry.** Radius is 2px (`--radius: 0.125rem`), with thin 1px
  borders and generous whitespace.
- **Typography carries the brand.** Headings are expanded, heavy and uppercase.
  Body text is normal width for readability.
- **Motion is a whisper.** Only 150–280ms colour, underline and slide
  transitions, all disabled under `prefers-reduced-motion`.
- **Mobile is designed, not shrunk.** It has its own header arrangement, a
  full-height menu, stacked full-width actions, 2-column product grids and
  44px touch targets.

## Colour tokens

The names follow the shadcn/ui contract, so generated components pick them up.

| Token                            | Light             | Inverted (`.surface-inverted`) | Use                           |
| -------------------------------- | ----------------- | ------------------------------ | ----------------------------- |
| `background` / `foreground`      | #fff / #0a0a0a    | #0a0a0a / #fafafa              | Page and text                 |
| `surface`                        | #f4f4f4           | #161616                        | Image wells, quiet sections   |
| `muted` / `muted-foreground`     | #efefef / #5e5e5e | #1f1f1f / #a3a3a3              | Hover fills / secondary text  |
| `primary` / `primary-foreground` | #0a0a0a / #fff    | #fafafa / #0a0a0a              | Primary buttons, badges       |
| `border`                         | #e4e4e4           | #2a2a2a                        | Decorative dividers           |
| `input`                          | #8a8a8a           | #6b6b6b                        | Form control borders          |
| `ring`                           | #0a0a0a           | #fafafa                        | Focus outline                 |
| `destructive`                    | #b42318           | —                              | Errors only, never decoration |

**Contrast (WCAG 2.2 AA):**

- Body text: 19.8:1.
- Muted text: at least 5.6:1 on every light surface, and 7.9:1 on black.
- Input borders: 3.45:1 on white and 3.72:1 on black, meeting the 3:1
  non-text contrast requirement.
- Axe runs in the E2E suite on every shell page.

**Inverted surfaces.** Add `surface-inverted` (or `<Section tone="inverted">`)
to switch a region to black. Every token is redefined there, so buttons, focus
rings and muted text adapt automatically. The footer and the homepage hero use it.

There is no dark mode. The brand is white-based with black bands.

## Typography

**Archivo** (variable, weight 100–900 and width 62–125) is the only typeface:
one self-hosted file via `next/font` (Latin subset, including å, ä and ö). The
width axis provides the expanded display voice without a second font.

| Role (utility) | Size                  | Weight | Width | Case      |
| -------------- | --------------------- | ------ | ----- | --------- |
| `type-display` | 27px → 96px (fluid)   | 800    | 125%  | uppercase |
| `type-h1`      | 32px → 56px (fluid)   | 800    | 118%  | uppercase |
| `type-h2`      | 24px → 38px (fluid)   | 750    | 112%  | uppercase |
| `type-h3`      | 18px                  | 650    | 100%  | sentence  |
| `type-lead`    | 17px → 20px (fluid)   | 400    | 100%  | sentence  |
| `type-eyebrow` | 12px, tracking 0.16em | 600    | 100%  | uppercase |
| `type-nav`     | 13px, tracking 0.08em | 600    | 100%  | uppercase |
| body           | 16px / 1.625          | 400    | 100%  | sentence  |

- Fluid sizes use `clamp()`, so headings scale continuously instead of jumping
  at breakpoints.
- The display size is tuned so "FÖRSEGLADE" fits a 320px screen.
- Headings use `text-wrap: balance`. They break a word only when it cannot fit
  at all (`overflow-wrap`); auto-hyphenation is off, because it split
  "Pokémon".
- Prices use tabular numerals.

## Layout

- `Container` sets the page frame: max 1440px, with gutters of 16px (mobile),
  24px (≥640px) and 40px (≥1024px). `size="prose"` caps the width at 672px for
  reading.
- `Section` sets vertical rhythm: 64 → 80 → 112px, or 40 → 48px for compact
  bands.
- Breakpoints are Tailwind's defaults. The header switches to the desktop
  layout at `lg` (1024px).
- `html { scrollbar-gutter: stable }` stops the page from shifting when a modal
  locks scrolling.

## Components

UI primitives (`src/components/ui`):

| Component                                    | Notes                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`, `ButtonLink`, `buttonClasses()`    | Variants: primary, secondary, ghost, link. Sizes: sm (36px), md (44px), lg (52px), icon (44px). Defaults to `type="button"`. `ButtonLink` is for navigation. |
| `Input`, `Textarea`, `Label`, `FieldMessage` | 16px text (no iOS zoom), 44px height, error style driven by `aria-invalid`.                                                                                  |
| `Badge`                                      | Status labels: solid, outline, muted.                                                                                                                        |
| `Container`, `Section`                       | Layout frame and vertical rhythm, including inverted sections.                                                                                               |
| `Skeleton`                                   | Loading placeholder; the pulse is off under reduced motion.                                                                                                  |
| Icons                                        | Nine hand-drawn outline icons (24px grid, 1.5px stroke), no icon library.                                                                                    |

Storefront components (`src/components/store`):

| Component                                           | Notes                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `StoreShell`                                        | Skip link, header, `<main id="innehall">` and footer.                              |
| `SiteHeader`                                        | Server component. See "Header" below.                                              |
| `MobileMenu`                                        | Client component, native `<dialog>` drawer.                                        |
| `NavLink`                                           | Client component; sets `aria-current` from the pathname.                           |
| `HeaderSearch`                                      | GET form to `/sok`, works without JavaScript.                                      |
| `CartButton`                                        | Presentational; badge-ready (`count`, capped "99+") with a `pulse` animation hook. |
| `SiteFooter`                                        | Inverted footer with link groups and an independence notice.                       |
| `Logo`                                              | Official asset from `brandAssets`, otherwise a text-only wordmark.                 |
| `Breadcrumbs`                                       | Visible trail; JSON-LD is added in Milestone 13.                                   |
| `PageHeader`, `SectionHeading`                      | Heading blocks with eyebrow, lead and an optional "Visa alla" link.                |
| `Price`                                             | VAT-inclusive price; the sale price is announced ("Nu …, tidigare …").             |
| `ProductCard`, `ProductCardSkeleton`, `ProductGrid` | Visual shell only. Badges and availability come from the caller.                   |
| `InfoPlaceholderPage`, `infoPageMetadata`           | Template for information and legal pages (currently `noindex`).                    |

The shadcn/ui CLI remains available (`components.json`). Generated components
use these tokens automatically. Review them against the principles above
(radius, weight, motion) before use.

## Header

- **Desktop (≥ 1024px):**
  - logo left;
  - uppercase primary navigation, where a 2px underline grows on hover and
    stays on the current section;
  - an inline search field and the cart on the right.
- **Mobile (< 1024px):**
  - menu button left, centered logo, then search and cart icons on the right;
  - every control is at least 44×44px.
- The header is sticky with a solid white background and a hairline border
  (no blur effects).

## Mobile menu

- Built on the native modal `<dialog>`, sliding in from the left (the cart
  drawer will slide from the right).
- The browser provides:
  - focus moves into the dialog (first stop: "Stäng meny");
  - the rest of the page becomes inert;
  - Escape closes it;
  - focus returns to the menu button on close.
- The component adds closing on:
  - the close button;
  - a backdrop click;
  - following any link;
  - route changes;
  - growing to the desktop breakpoint.
- It also keeps `aria-expanded` in sync and locks page scrolling while open.
- Contents: search, the four primary links in large expanded type, and
  customer-service links.
- The enter/exit animation uses `@starting-style` where supported; elsewhere
  the menu simply appears.

## Cart (preparation for Milestone 5)

- `CartButton` receives `count` (total quantity) and `pulse`.
- Milestone 5 wraps it in a client component that:
  - supplies live state;
  - triggers the `animate-cart-pulse` keyframes (scale 1 → 1.14 → 1, 450ms,
    `motion-safe` only) after an add;
  - opens the drawer on click.
- The drawer reuses the `.drawer` styles with `data-side="right"`.
- It must never open automatically.

## Accessibility decisions

- **Landmarks:** banner, `nav` elements with Swedish labels ("Huvudmeny",
  "Kundservice", "Brödsmulor"), main and contentinfo.
- **Skip link:** "Hoppa till innehållet" is the first tab stop.
- **Focus:** a visible 2px focus outline everywhere, in the ring colour, which
  adapts on black surfaces.
- **Icon-only controls** have Swedish `aria-label`s ("Öppna meny", "Sök",
  "Kundvagn, tom" / "Kundvagn, 3 artiklar"). Icons are `aria-hidden`.
- **Prices:** strikethrough prices are never the only signal.
- **Form fields** always have labels (visually hidden in the header search).
- **Automated checks:** axe (WCAG 2.2 A/AA) and keyboard behaviour are covered
  in `e2e/storefront-shell.spec.ts`.

## Server and client boundaries

Everything is a Server Component except:

- `NavLink`, for `aria-current`;
- `MobileMenu`, for open/close wiring. Its contents are passed as server-rendered
  children.

The header, footer, search form, product card and all primitives ship no
client JavaScript.

## Logo

- The official mark is `public/brand/heavycards-mark.svg`: one path with
  `fill="currentColor"` (viewBox 559 × 684). It is configured in
  `src/lib/config/brand.ts` (`brandAssets.mark`).
- `BrandMark` renders it as a CSS mask over `background-color: currentColor`,
  so the **same file** is used everywhere: black in the header, white in the
  inverted footer, and faint inside image placeholders. There are no raster
  variants and no `filter: invert()`. The intrinsic aspect ratio is set, so
  nothing shifts while it loads.
- In forced-colors mode (Windows High Contrast), background colours are
  overridden, so `.brand-mark` is pinned to the system `CanvasText` colour.
- `Logo` is the mark linking home; its accessible name is
  "HeavyCards – till startsidan". Never redraw or recolour the mark beyond
  `currentColor`.

## Catalog components (Milestone 4)

| Component                                           | Notes                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProductListing`                                    | Grid, pagination and empty state. The first four cards get image priority (LCP).                                                                 |
| `CatalogToolbar`                                    | GET form with labelled selects (category, set, availability, sort) and a "Visa" button. Nothing navigates on change (WCAG 3.2.2).                |
| `Pagination`                                        | Previous/next links with `rel`, plus "Sida X av Y".                                                                                              |
| `EmptyState`                                        | Calm bordered message with an optional action.                                                                                                   |
| `CategoryTiles`                                     | Category navigation with product counts; empty categories are hidden. Sets are reached through the set filter, set pages and product-page links. |
| `ProductGallery`                                    | Fixed square frame (no layout shift). Server-rendered for 0–1 images; a client thumbnail gallery only for 2+ images.                             |
| `ProductImagePlaceholder`, `ImagePlaceholder`       | Neutral grey square with a faint brand mark, used while products have no photos. Decorative (`aria-hidden`).                                     |
| `PurchasePanel`, `AvailabilityStatus`               | Availability (filled dot = available, ring = not), release date and preorder terms. The purchase control is a slot (`action`).                   |
| `PurchaseAction`                                    | Add-to-cart for purchasable products, a disabled state label when sold out, nothing when not orderable yet (Milestone 5).                        |
| `StarRating`, `ProductReviews`, `ReviewSummaryLink` | Monochrome stars filled to the exact average; the accessible text states the rating in words. Approved reviews only.                             |
| `ListingSkeleton`                                   | Loading state for `/nyheter`, `/kommande` and `/sok`.                                                                                            |

**Product card badges:**

- Slutsåld (muted)
- Förbeställ (solid)
- Kommer snart (outline)
- Få kvar (outline)
- Nyhet (outline): only for products in stock that were published within 30 days

Cards show at most two badges. Unavailable products have dimmed images, and
future releases get a "Släpps 14 november 2026" note under the price.

## Cart components (Milestone 5)

| Component         | Notes                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CartProvider`    | Client boundary in `StoreShell`: server-rendered children pass through unchanged. Renders the drawer and a polite `role="status"` announcer once.                                                                                        |
| `CartTrigger`     | Header button: live unit count (`aria-label` "Kundvagn, 3 artiklar"; badge caps at "99+"). `aria-haspopup="dialog"` and `aria-expanded`. The only way the drawer opens, apart from the explicit "Visa kundvagnen" in a conflict message. |
| `AddToCart`       | Quantity stepper plus "Lägg i kundvagn"/"Förbeställ". On success: "✓ Tillagd" for 1.2 s, badge update, icon pulse. Never opens the drawer. Conflicts and limits appear as inline Swedish messages (`role="alert"`/`"status"`).           |
| `CartDrawer`      | Native modal `<dialog>`, sliding in from the right (`.drawer[data-side="right"]`). 448 px wide from the `sm` breakpoint, viewport width minus 24 px on phones. Header and footer are fixed; the product list scrolls.                    |
| `QuantityStepper` | Labelled group: "Minska antal", a numeric input (committed on blur/Enter, clamped) and "Öka antal". Buttons are disabled at the limits; all targets are ≥ 44 px.                                                                         |

**Pulse:** `CartButton` takes a `pulseKey`. Every successful add increments
it, which remounts the icon and replays the 450 ms `cart-pulse` keyframes
once. The animation is `motion-safe` only and is also disabled by the global
reduced-motion rule.
