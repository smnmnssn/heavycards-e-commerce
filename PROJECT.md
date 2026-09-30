# HeavyCards E-commerce Platform

## 1. Project Overview

HeavyCards is a Swedish e-commerce store focused primarily on sealed Pokémon TCG products.

The company branding is minimalist, premium and monochrome. The HeavyCards logo uses a black/white shield-style visual identity. The store UI must follow this identity without competing visually with the colorful Pokémon product packaging.

The initial market is Sweden only.

This is a real production e-commerce application handling:

- real customers
- real payments
- real inventory
- real orders
- customer personal data
- multiple administrators

Treat the project accordingly.

This is not a prototype or school project.

---

# 2. Primary Goals

Build a clean, fast, SEO-focused Swedish e-commerce experience where customers can:

1. Browse Pokémon TCG products
2. Search and filter products
3. View product details
4. Add products to a cart
5. Checkout without creating an account
6. Pay using supported Stripe payment methods
7. Receive order confirmation emails
8. Receive shipping confirmation emails
9. Leave verified product reviews after purchase

HeavyCards administrators must be able to manage normal store operations through `/admin` without accessing Prisma, PostgreSQL, source code or infrastructure dashboards.

---

# 3. Market and Localization

Initial market:

- Sweden only

Language:

- Swedish only

Currency:

- SEK

Locale:

- `sv-SE`

Application timezone:

- `Europe/Stockholm`

Prices displayed to customers must be VAT-inclusive.

Tax-related values should be modeled so the implementation is not dependent on one permanently hardcoded VAT percentage.

Do not add multi-currency or international shipping in V1.

---

# 4. Core Technology Stack

Use:

- Next.js
- App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui where useful
- custom HeavyCards components/styles
- PostgreSQL
- Prisma ORM
- Stripe
- Resend
- Zod
- React Hook Form
- Vitest
- Playwright
- Vercel
- Git/GitHub
- npm

Product images must use proper object/blob storage rather than being committed to the Git repository.

Vercel Blob is an acceptable default for V1 unless an existing storage provider is already configured.

Do not tightly couple application logic to the storage provider. Keep storage operations behind a small internal abstraction.

---

# 5. Dependency Rules

This project values predictable builds.

Rules:

- use stable production releases
- use exact package versions
- do not use `^`
- do not use `~`
- commit `package-lock.json`
- use `npm ci` in CI
- define an appropriate Node.js engine compatible with the chosen Next.js/Vercel version
- do not introduce packages without a clear reason

Before installing the initial stack, verify that the selected package versions are mutually compatible.

Do not blindly copy version numbers from old examples.

---

# 6. Architecture

HeavyCards should be a single Next.js application containing:

- public storefront
- admin application
- server-side application logic
- route handlers/server actions where appropriate
- Prisma data access
- Stripe integration
- Resend integration

Do not create a separate Express backend.

High-level architecture:

Customer/Admin
→ Next.js application
→ server-side domain/services
→ Prisma
→ PostgreSQL

External services:

Next.js
→ Stripe

Next.js
→ Resend

Next.js
→ image/blob storage

---

# 7. Design Direction

The supplied HeavyCards logo is the visual reference.

Design characteristics:

- premium
- clean
- minimalist
- black
- white
- neutral grayscale
- generous whitespace
- restrained borders
- subtle animation
- strong typography
- product imagery provides most of the color

Avoid:

- overly colorful site chrome
- generic gaming aesthetics
- neon colors
- excessive gradients
- excessive rounded cards
- excessive animations
- clutter
- childish Pokémon-inspired UI elements

The HeavyCards brand itself should not attempt to visually imitate Pokémon branding.

Product photography and actual product packaging will naturally provide color.

---

# 8. Responsive Design

Mobile-first is required.

All storefront and admin functionality must work on:

- mobile
- tablet
- desktop

The public store should be particularly polished on mobile.

Do not treat mobile as a desktop layout compressed to a smaller width.

---

# 9. Main Store Navigation

Initial navigation should remain intentionally simple.

Example:

- Nyheter
- Pokémon TCG
- Kommande
- Om oss

Header should also provide:

- search
- cart icon

Do not overload the navigation with every product category.

---

# 10. Homepage

The homepage should support the following sections.

## Hero

A large branded/release-focused area.

Can highlight:

- a new Pokémon set
- a featured release
- HeavyCards branding

The content should be structured so products can later be selected as featured from admin.

## New arrivals

Show recently published products.

## Categories

Examples:

- Booster Boxes
- Elite Trainer Boxes
- Booster Packs
- Collection Boxes
- Tins

## Featured / popular products

Admin-controlled featured products.

## Upcoming releases

Products with future release dates may appear here.

The homepage should not require code changes whenever inventory changes.

---

# 11. Product Types

The initial business primarily sells sealed Pokémon TCG products.

However, do not design the core `Product` model in a way that permanently assumes every product is sealed.

Supported conceptual product types:

- SEALED
- SINGLE
- GRADED
- ACCESSORY
- OTHER

V1 storefront/admin functionality only needs to fully support the fields required for normal sealed products and generic products.

Future singles may need:

- card name
- card number
- rarity
- condition
- language
- foil type

Future graded cards may need:

- grading company
- grade
- certification number

Do not implement all future fields in V1 unless required.

Design the architecture so future type-specific detail tables can be added without replacing the core product system.

---

# 12. Product Model

Conceptual fields:

- id
- name
- slug
- shortDescription
- description
- productType
- priceAmount
- compareAtPriceAmount
- sku
- stockOnHand
- status
- categoryId
- pokemonSetId
- isFeatured
- isPreorder
- releaseDate
- seoTitle
- seoDescription
- publishedAt
- createdAt
- updatedAt

Money must be stored as integer minor units.

Example:

`149900` = `1 499,00 SEK`

Do not use JavaScript floating-point values as the source of truth for money.

Currency for V1 is SEK.

---

# 13. Product Status

Use explicit editorial status such as:

- DRAFT
- ACTIVE
- COMING_SOON
- ARCHIVED

Do not use `SOLD_OUT` as a manually managed editorial status.

Sold-out state should normally be derived from available inventory.

A product may therefore be:

`ACTIVE` + available quantity `0`

and the storefront displays:

`SLUTSÅLD`

Archived products must not normally be purchasable.

---

# 14. Product Images

A product supports multiple images.

Conceptual model:

ProductImage

- id
- productId
- storageKey/url
- altText
- position
- createdAt

Admin must be able to:

- upload images
- remove images
- reorder images
- set image alt text

The first ordered image is the primary image.

Validate:

- MIME type
- extension where appropriate
- file size
- maximum reasonable dimensions/processing requirements

Never trust filename alone.

---

# 15. Categories

Categories must live in the database.

Examples:

- Booster Boxes
- Elite Trainer Boxes
- Booster Packs
- Collection Boxes
- Tins
- Accessories

Conceptual fields:

Category

- id
- name
- slug
- description
- seoTitle
- seoDescription
- createdAt
- updatedAt

Category pages must be real server-rendered/indexable landing pages.

Do not implement categories solely as client-side filters.

---

# 16. Pokémon Sets

Sets are separate from categories.

Example:

Product:
`Destined Rivals Booster Box`

Category:
`Booster Box`

Pokémon Set:
`Destined Rivals`

Conceptual fields:

PokemonSet

- id
- name
- slug
- description
- releaseDate
- seoTitle
- seoDescription
- createdAt
- updatedAt

Set pages must be usable as SEO landing pages.

---

# 17. Storefront Product Listing

Customers should be able to:

- browse products
- search products
- filter by category
- filter by Pokémon set
- filter by stock availability
- sort by newest
- sort by price ascending
- sort by price descending

Do not introduce Elasticsearch, Algolia or a separate search infrastructure in V1.

PostgreSQL search is sufficient for the expected initial catalog size.

Search architecture should remain replaceable later.

---

# 18. Product Page

A product page should support:

- product gallery
- product name
- price
- compare-at price when applicable
- stock status
- quantity selector
- add-to-cart button
- description
- category
- Pokémon set
- release date when applicable
- preorder state when applicable
- review summary
- approved reviews
- breadcrumbs
- SEO metadata
- structured data

SKU does not necessarily need prominent customer-facing placement but should exist internally.

---

# 19. Cart UX

The cart is a right-side drawer.

It opens only when the customer explicitly clicks the cart icon.

## IMPORTANT

Adding a product to the cart must NOT automatically open the cart drawer.

When the customer clicks:

`LÄGG I KUNDVAGN`

provide confirmation through all of the following:

1. Button temporarily changes to:
   `✓ TILLAGD`

2. Cart badge updates immediately.

3. Cart icon performs a subtle animation/pulse.

After approximately 1–1.5 seconds, the button returns to:

`LÄGG I KUNDVAGN`

Avoid intrusive modal dialogs.

A small toast is optional but is not required if the above feedback is clear.

---

# 20. Cart Badge

The cart badge represents total item quantity, not number of unique cart lines.

Example:

- 2 × Booster Box
- 1 × ETB

Cart badge:

`3`

not:

`2`

---

# 21. Cart Drawer

Desktop:

- opens from right side
- background receives a restrained overlay
- drawer remains visually consistent with HeavyCards branding

Mobile:

- opens from right
- may occupy most of the viewport width

The drawer should contain:

- product image
- product name
- unit price
- quantity controls
- remove action
- subtotal
- shipping note
- checkout button

Example checkout button:

`TILL KASSAN`

Shipping can display:

`Beräknas i kassan`

until the checkout calculation is finalized.

---

# 22. Cart Persistence

Guest cart should persist between normal page refreshes/browser navigation.

Client persistence is acceptable.

The client cart must only be treated as a list of intended purchases.

The client must NOT be the source of truth for:

- price
- stock
- product status
- discount values
- shipping price
- checkout total

At checkout, server-side code must reload products from PostgreSQL and calculate everything again.

---

# 23. Checkout

V1 should use Stripe-hosted Checkout unless a strong technical reason requires another Stripe-hosted integration.

Do not build custom card handling.

HeavyCards must never directly receive raw card numbers.

Customers do not need an account.

Use guest checkout.

The customer should be able to provide the required shipping/customer information through checkout.

Typical required information:

- email
- first name
- last name
- shipping address
- postal code
- city
- Sweden
- phone number when required

---

# 24. Payment Methods

Stripe is the payment platform.

The store wants to support:

- cards
- Swish
- Klarna

Configure Stripe so the relevant payment methods can be enabled for the Swedish store/account.

Do not hardcode assumptions that every Stripe payment method is always available.

The application must gracefully allow Stripe to expose the payment methods that are currently active and eligible for the session/customer.

Currency is SEK.

---

# 25. Never Trust Client Prices

The checkout request should essentially identify:

- product
- quantity

The server then loads the authoritative product.

The server must verify:

- product exists
- product can be sold
- quantity is valid
- sufficient inventory is available
- authoritative current price
- shipping amount
- totals

Never accept a client-provided total as authoritative.

---

# 26. Inventory and Checkout Concurrency

Prevent overselling.

This is a hard requirement.

Example:

Only one unit is actually available.

Two customers must not both successfully purchase the same final unit.

Implement proper server/database concurrency handling.

Preferred conceptual approach:

- `stockOnHand` stores physically available stock
- active checkout reservations temporarily reserve units
- available-to-sell quantity accounts for active reservations
- reservations expire if checkout is abandoned
- payment completion consumes the reservation
- expiration/failure releases the reservation

An `InventoryReservation` model is acceptable.

Conceptual fields:

- id
- orderId
- productId
- quantity
- status
- expiresAt
- createdAt

Possible status values:

- ACTIVE
- CONSUMED
- RELEASED

Inventory availability checks and reservation creation must occur atomically using a database transaction/isolation strategy appropriate for PostgreSQL.

Do not implement:

read stock
→ wait
→ blindly update

without concurrency protection.

The exact Prisma/PostgreSQL implementation may use transactions, appropriate isolation and retry handling.

Document the chosen approach.

---

# 27. Orders

Conceptual Order model:

- id
- orderNumber
- email
- firstName
- lastName
- phone
- addressLine1
- addressLine2
- postalCode
- city
- country
- subtotalAmount
- shippingAmount
- taxAmount
- totalAmount
- currency
- paymentStatus
- fulfillmentStatus
- stripeCheckoutSessionId
- stripePaymentIntentId
- shippingCarrier
- trackingNumber
- shippedAt
- confirmationEmailSentAt
- shippingEmailSentAt
- createdAt
- updatedAt

Do not expose the database ID as the customer-facing order number.

---

# 28. Customer-Facing Order Numbers

Use readable HeavyCards order numbers such as:

- HC-10001
- HC-10002
- HC-10003

Generation must be concurrency-safe.

There must never be duplicate order numbers.

Do not derive security decisions from the public order number.

---

# 29. Payment Status vs Fulfillment Status

Keep payment and fulfillment state separate.

Payment status examples:

- PENDING
- PAID
- PARTIALLY_REFUNDED
- REFUNDED
- FAILED

Fulfillment status examples:

- NEW
- PROCESSING
- SHIPPED
- COMPLETED
- CANCELLED

Example valid state:

Payment:
`PAID`

Fulfillment:
`PROCESSING`

Avoid a single overloaded order-status field.

---

# 30. Order Items

Conceptual OrderItem model:

- id
- orderId
- productId
- productNameSnapshot
- skuSnapshot
- quantity
- unitPriceAmount
- totalPriceAmount
- createdAt

Historical order values must remain historically correct.

If a product changes from 1499 SEK to 1799 SEK later, an old order must still show 1499 SEK.

Do not recalculate historic orders from current Product data.

---

# 31. Stripe Webhooks

Stripe webhook processing is security-critical.

Requirements:

- verify Stripe webhook signatures
- use raw request body as required by Stripe
- reject invalid signatures
- make event processing idempotent
- persist processed Stripe event IDs
- never double-process the same event

Create a model such as:

StripeEvent

- id
- stripeEventId
- type
- processedAt
- createdAt

`stripeEventId` must be unique.

---

# 32. Payment Completion

Do NOT mark an order paid just because the customer visits a success URL.

The source of truth is Stripe webhook verification.

Support the relevant Checkout/payment lifecycle, including delayed/asynchronous payment cases where applicable.

The implementation should handle relevant events such as:

- successful checkout/payment
- asynchronous payment success if applicable
- asynchronous payment failure if applicable
- checkout expiration
- refunds

The exact Stripe event set should be selected based on the final Checkout integration.

On verified successful payment:

- mark payment as paid
- finalize/consume inventory reservations
- record relevant Stripe identifiers
- send order confirmation exactly once
- create review eligibility/token data
- log appropriate system/audit information

All handlers must be safe to retry.

---

# 33. Checkout Expiration / Failure

If an unpaid checkout reservation expires or definitively fails:

- release the inventory reservation
- do not send order confirmation
- do not mark the order paid

Stale reservation cleanup must exist as a safety mechanism in case an external webhook is missed.

Do not allow stale reservations to permanently block inventory.

---

# 34. Refunds

V1 refunds are performed in the Stripe Dashboard.

Do not build a custom refund form in HeavyCards V1.

The HeavyCards admin order page should provide:

- Stripe payment status
- relevant Stripe identifiers
- a convenient action/link to open the relevant Stripe record when possible

Stripe webhooks must synchronize refunds back to HeavyCards.

Supported HeavyCards states:

- REFUNDED
- PARTIALLY_REFUNDED

Do not let the HeavyCards database remain `PAID` after Stripe reports a refund.

---

# 35. Refund Inventory Rule

Refunding money must NOT automatically restock physical inventory.

A refunded item could be:

- opened
- damaged
- not yet returned
- lost
- non-resellable

Inventory is only increased when an administrator intentionally confirms that the item is physically available for sale again.

---

# 36. Stripe Dashboard Access

HeavyCards staff can use Stripe's own Dashboard for payment/refund operations.

Do not share one Stripe password between staff members.

Use Stripe's team/member permission system.

Stripe access and HeavyCards `/admin` access are separate systems.

---

# 37. Shipping

Primary delivery provider:

PostNord

V1 does NOT require PostNord API integration.

Shipping should initially support a configurable flat shipping price.

Also support an optional free-shipping threshold.

These values must not be hardcoded in storefront components.

Store them in application/store settings.

Example conceptual settings:

- shippingPriceAmount
- freeShippingThresholdAmount
- defaultShippingCarrier

Admins should be able to update relevant commercial settings without editing code.

---

# 38. Shipping Fields

Prepare order data for future PostNord integration.

Include:

- shippingCarrier
- trackingNumber
- shippedAt

V1 may allow the admin to manually enter a tracking number.

If a tracking number exists, the shipping email should display it.

Do not fabricate a PostNord tracking URL if no reliable supported URL format is configured.

---

# 39. Marking an Order as Shipped

Admin order flow:

`PROCESSING`
→ `SHIPPED`

When successfully transitioning to SHIPPED:

- update fulfillment status
- set `shippedAt`
- write AuditLog
- send shipping email

Shipping email must only be sent once unless an explicit resend feature is later created.

Use `shippingEmailSentAt` or equivalent idempotency state.

Saving an already-shipped order must not accidentally send another email.

---

# 40. Emails

Use Resend.

Initial transactional emails:

1. order confirmation
2. order shipped

All customer-facing email text must be Swedish.

Email styling:

- HeavyCards branding
- black/white
- minimal
- mobile friendly
- compatible with common email clients

Do not make email templates excessively complex.

Use environment configuration for sender addresses.

Do not hardcode an unverified production email domain.

---

# 41. Order Confirmation Email

Send only after verified successful payment.

Should contain at minimum:

- HeavyCards branding
- customer name
- public order number
- items
- quantities
- price summary
- shipping information
- customer support/contact information

Do not claim the order has shipped.

---

# 42. Product Reviews

Customers can leave product reviews.

Review content:

- 1–5 star rating
- display name
- optional title
- review text
- verified purchase marker

Conceptual Review fields:

- id
- productId
- orderItemId
- displayName
- rating
- title
- body
- verifiedPurchase
- status
- createdAt
- updatedAt

Review status:

- PENDING
- APPROVED
- REJECTED

Only APPROVED reviews appear publicly.

Only APPROVED reviews contribute to public aggregate ratings.

---

# 43. Verified Purchase Reviews

HeavyCards must support verified-purchase reviews.

A customer who actually bought a product can receive:

`Verifierat köp`

on their review.

Verified status must be established server-side from the actual paid order/order items.

Never trust a client-provided `verifiedPurchase = true`.

---

# 44. Review Link

A unique secure review link must be created for eligible paid orders.

Do not expose:

- customer email as authentication
- predictable order identifiers as authentication
- plaintext secret tokens in the database

Use a cryptographically secure token.

The customer receives the raw token in the URL.

Store only a secure hash of the token in PostgreSQL.

Conceptual ReviewToken fields:

- id
- orderId
- tokenHash
- expiresAt
- createdAt
- revokedAt

A reasonable expiration period may be used, for example around 180 days.

Document the chosen expiration behavior.

---

# 45. When to Send the Review Link

Do NOT require the customer to review immediately after payment.

The review link should be included in the shipping email.

Example conceptual email section:

`När du har fått din beställning får du gärna berätta vad du tycker.`

Then link to the secure review page.

A separate delayed review-request email can be added later but is not required for V1.

---

# 46. Review Page

The secure review URL should allow the customer to see products from their eligible order.

Example:

RECENSERA DITT KÖP

Product A
★★★★★
review form

Product B
★★★★★
review form

The customer can only submit verified reviews for products actually purchased on that order.

If quantity was 3 of the same product, the customer should still normally submit one product review, not three duplicate reviews.

Enforce this server-side.

---

# 47. Review Moderation

Admin area must contain review moderation.

Admins can:

- view pending reviews
- approve
- reject
- delete where appropriate

Admin dashboard should display pending review count.

---

# 48. Admin Area

Admin base route:

`/admin`

Admin routes must never be treated as security simply because they are not linked publicly.

All admin authorization must be enforced server-side.

Initial sections:

- Dashboard
- Products
- Categories
- Pokémon Sets
- Orders
- Reviews
- Admin Users
- Settings
- Audit Log if appropriate

---

# 49. Multi-Admin Support

The admin system must support multiple individual administrator accounts.

Do NOT use:

- one shared admin password
- an environment variable password
- one shared login

Conceptual AdminUser fields:

- id
- name
- email
- passwordHash or auth-provider equivalent
- role
- isActive
- createdAt
- updatedAt

Use unique individual identities.

---

# 50. Admin Roles

V1 roles:

## OWNER

Can:

- perform normal administration
- manage administrators
- modify sensitive store settings
- access all admin areas

## ADMIN

Can:

- manage products
- manage inventory
- manage orders
- manage reviews
- manage categories
- manage Pokémon sets

ADMIN must not be able to remove/demote the last OWNER.

Role checks must happen server-side.

Do not hide a button in React and call that authorization.

---

# 51. Admin Authentication

Do not hand-roll insecure authentication/session cryptography.

Use a well-maintained authentication solution compatible with:

- Next.js App Router
- multi-user admin login
- secure password authentication
- secure sessions
- server-side authorization

No public admin registration page.

Preferred onboarding flow:

OWNER
→ invites admin email
→ one-time secure invitation
→ invited user sets password
→ account becomes active

Invitation tokens must:

- be cryptographically random
- be stored hashed
- expire
- be single-use

Password hashing must use a modern secure password hashing algorithm/library.

Sessions/cookies must use appropriate:

- HttpOnly
- Secure in production
- SameSite settings

Prepare the architecture so admin 2FA can be added later.

2FA is desirable but does not have to block the earliest implementation milestone.

---

# 52. Admin Dashboard

Dashboard should prioritize operational information.

Initial widgets:

- revenue
- order count
- orders requiring handling
- low-stock product count
- pending review count
- recent orders

Do not turn V1 into a complex analytics product.

Revenue calculations must clearly define which payment/refund states are included.

---

# 53. Product Administration

Admins can:

- create product
- edit product
- archive product
- publish product
- edit price
- edit compare-at price
- edit SKU
- edit stock
- assign category
- assign Pokémon set
- choose product type
- upload/reorder/delete images
- set featured status
- configure preorder
- configure release date
- edit SEO fields

Normal UI should prefer Archive over destructive permanent deletion for products that have historical relationships.

Products referenced by historical orders must never cause order history to break.

---

# 54. Admin Product Form

Typical sections:

## Basic information

- name
- slug
- short description
- full description
- product type
- category
- Pokémon set

## Commerce

- price
- compare-at price
- SKU
- stock

## Release

- status
- preorder
- release date
- featured

## Images

- upload
- reorder
- alt text

## SEO

- SEO title
- meta description
- slug preview

Generate reasonable SEO defaults when custom values are blank.

Do not force admins to understand SEO in order to publish a valid product.

---

# 55. Admin Order View

Order view should display:

- HeavyCards order number
- payment status
- fulfillment status
- order date
- customer
- email
- phone
- shipping address
- ordered items
- quantity
- historic prices
- subtotal
- shipping
- tax
- total
- Stripe identifiers
- tracking details
- audit/history where appropriate

Actions may include:

- mark processing
- mark shipped
- mark completed
- manually restock returned item where appropriate
- open Stripe payment/refund management

Do not create a V1 refund form.

---

# 56. Audit Logging

Because multiple admins can change products/orders, record important administrative actions.

Conceptual AuditLog fields:

- id
- adminUserId
- action
- entityType
- entityId
- metadata
- createdAt

Examples:

`UPDATE_PRODUCT_STOCK`

Stock:
15 → 12

`UPDATE_ORDER_STATUS`

PROCESSING → SHIPPED

`APPROVE_REVIEW`

Do not store secrets, raw passwords, full payment credentials or sensitive tokens in audit metadata.

---

# 57. Store Settings

Use a store settings model/configuration rather than scattering values throughout code.

Possible settings:

- storeName
- contactEmail
- companyName
- organizationNumber
- shippingPriceAmount
- freeShippingThresholdAmount
- defaultShippingCarrier
- defaultSeoTitle
- defaultSeoDescription

There should normally be one active store configuration for V1.

Sensitive secrets do not belong in StoreSettings.

Stripe keys, Resend keys, auth secrets etc. belong in environment variables.

---

# 58. SEO Priority

SEO is a first-class requirement.

Do not implement SEO as a cleanup task at the end.

The architecture and page structure must support SEO from the beginning.

Main objectives:

- excellent technical SEO
- indexable product pages
- indexable category landing pages
- indexable set landing pages
- strong internal linking
- high Core Web Vitals performance
- clean URLs
- structured data
- correct metadata
- high quality crawlability

---

# 59. SEO Page Rendering

Important storefront content should be server-rendered/static-rendered where appropriate.

Do not make product/category content dependent on client-side JavaScript before Google can see it.

Use appropriate Next.js rendering/caching/revalidation strategies.

Inventory/pricing must remain sufficiently fresh for commerce correctness.

Do not sacrifice correctness simply to obtain static rendering.

---

# 60. SEO URLs

URLs must be:

- readable
- stable
- lowercase
- slug-based
- free from database IDs where unnecessary

Examples may include:

- `/pokemon-tcg`
- `/kategori/booster-boxes`
- `/set/destined-rivals`
- `/pokemon-tcg/destined-rivals-booster-box`

Exact route naming may be adjusted if required to avoid route ambiguity, but route structure must remain clean and SEO friendly.

Document the final route design before implementing dozens of pages.

---

# 61. Slug Changes and Redirects

Changing an already-published slug must not silently destroy the old SEO URL.

Create permanent redirects.

Conceptual Redirect model:

- id
- sourcePath
- destinationPath
- permanent
- createdAt

When a published product/category/set slug changes:

old URL
→ HTTP 301/308 permanent redirect
→ new URL

Prevent redirect loops.

---

# 62. Metadata

Each indexable page should have appropriate:

- title
- meta description
- canonical URL
- Open Graph metadata
- social preview image where appropriate

Products should have sensible generated defaults.

Admins can override:

- SEO title
- meta description

Do not require manual metadata for every product.

---

# 63. Structured Data

Implement valid JSON-LD where appropriate.

Examples:

Homepage:

- Organization
- WebSite

Product page:

- Product
- Offer
- AggregateRating when valid data exists
- Review when appropriate
- BreadcrumbList

Category/set pages:

- BreadcrumbList
- relevant collection metadata where appropriate

Only output real review/availability/price data.

Do not create fake ratings for SEO.

Structured-data URLs and prices must match visible page information.

---

# 64. Sitemap

Generate sitemap data dynamically.

Include indexable:

- products
- categories
- Pokémon sets
- important static pages

Do not include:

- admin
- checkout
- private order pages
- review-token pages

Sitemap timestamps should be meaningful when possible.

---

# 65. Robots / Noindex

Explicitly protect non-search pages from indexing where appropriate.

Examples:

- `/admin/*`
- checkout flow
- private order pages
- secure review-token pages

Filtered/sorted combinations must be handled carefully so search engines do not index thousands of duplicate URL variants.

Use canonical/noindex strategy where needed.

---

# 66. Breadcrumbs

Use visible and structured breadcrumbs.

Example:

Hem
→ Pokémon TCG
→ Booster Boxes
→ Destined Rivals Booster Box

Breadcrumbs must remain useful on mobile.

---

# 67. Product Image SEO and Performance

Requirements:

- responsive image sizes
- proper dimensions
- avoid layout shift
- lazy load non-critical images
- optimize primary/LCP imagery appropriately
- descriptive alt text
- do not load oversized source assets unnecessarily

If admin leaves alt text blank, the system may generate a sensible default from the product name.

Admin-provided alt text takes precedence.

---

# 68. Core Web Vitals

Performance is part of SEO.

Pay attention to:

- LCP
- CLS
- INP

Avoid:

- unnecessary client components
- giant JavaScript bundles
- excessive animation libraries
- layout shifts from images
- unnecessary third-party scripts

Use Server Components by default where appropriate.

Only use `"use client"` when interactivity requires it.

---

# 69. Search Engine Console

The production launch checklist should include:

- Google Search Console verification
- sitemap submission
- inspection of important product/category pages

Do not hardcode a verification token in source if the chosen verification method does not require it.

---

# 70. Analytics

Analytics is secondary to the core commerce application.

Do not add a large tracking stack without a reason.

If analytics requiring cookies is introduced, the privacy/cookie implementation must be considered before production.

Google Search Console should still be prepared because SEO is a priority.

---

# 71. Legal / Informational Pages

Prepare routes for:

- Köpvillkor
- Integritetspolicy
- Cookiepolicy
- Retur & ångerrätt
- Leveransinformation
- Kontakt
- Om oss

The business owner must review legal wording before production launch.

Do not imply that HeavyCards is an official Pokémon company/store unless it actually has such authorization.

The site's own brand should remain HeavyCards.

---

# 72. Error Handling

Customer-facing users must not receive internal exceptions such as:

- Prisma error codes
- raw database errors
- stack traces
- Stripe secrets
- implementation details

Customer receives a Swedish, understandable message.

Detailed technical context belongs in secure server logs.

---

# 73. Validation

Use Zod at server boundaries.

Validate all untrusted input including:

- admin forms
- query parameters
- checkout requests
- review submissions
- authentication-related forms
- webhook-derived metadata where assumptions exist

Client validation improves UX.

Server validation is authoritative.

---

# 74. Security Requirements

Security is a hard requirement.

At minimum:

- server-side authorization
- server-side validation
- secure auth sessions
- secure password hashing
- Stripe webhook signature validation
- idempotent payment event handling
- rate limiting/abuse controls on sensitive endpoints
- secure secret handling
- no secrets in client bundles
- no raw card handling
- no client-authoritative pricing
- safe image upload validation
- appropriate CSRF strategy
- output escaping/XSS-safe rendering
- secure HTTP headers where appropriate
- least-privilege access

Do not log:

- passwords
- auth tokens
- review raw secret tokens
- Stripe secret keys
- full payment credentials

---

# 75. Environment Variables

Create `.env.example`.

It should include names only / safe examples, never real secrets.

Expected categories may include:

- DATABASE_URL
- DIRECT_DATABASE_URL if provider requires it
- application/auth secret
- STRIPE_SECRET_KEY
- NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY if required
- STRIPE_WEBHOOK_SECRET
- RESEND_API_KEY
- EMAIL_FROM
- storage credentials
- application base URL

Validate environment variables on startup/build where appropriate.

Never commit `.env.local`.

---

# 76. Database Migrations

Prisma schema is developer infrastructure.

Store administrators never work directly with Prisma.

Use migrations for schema changes.

Development workflow:

change Prisma schema
→ create migration
→ review migration
→ apply/test locally
→ commit migration
→ deploy safely

Never rely on manually editing production database structure.

Do not use destructive resets in production.

---

# 77. Prisma Responsibilities

Prisma is used by the application/developer layer for:

- querying products
- updating products
- orders
- inventory
- reviews
- admins
- settings
- transactions
- migrations

HeavyCards staff use `/admin`.

They do not need:

- Prisma Studio
- Prisma CLI
- PostgreSQL access

Prisma Studio may be used by developers for local debugging only.

---

# 78. Admin Business Rules

All important rules must exist server-side.

Example:

An admin edits:

Stock: `12 → 8`

The server must:

- validate admin session
- validate role
- validate integer >= 0
- update through Prisma
- write audit log

Do not depend on the form UI alone to enforce rules.

---

# 79. Testing Strategy

Use both Vitest and Playwright.

Do not aim for arbitrary 100% coverage.

Prioritize financial, inventory, permissions and order logic.

---

# 80. Vitest

Vitest should cover important domain/service logic.

Examples:

- money calculations
- shipping calculations
- free-shipping threshold
- cart/checkout validation
- inventory availability logic
- inventory reservation logic
- order number generation logic
- allowed order transitions
- review eligibility
- review token verification
- admin permission helpers
- Stripe event handling/idempotency helpers

Prefer small deterministic tests.

External providers should be mocked at unit/integration boundaries where appropriate.

---

# 81. Playwright E2E

Playwright tests should cover critical real browser workflows.

Minimum intended flows:

## Store

1. Browse product
2. Add product to cart
3. Confirm cart does NOT automatically open
4. Confirm button temporarily changes to `TILLAGD`
5. Confirm cart badge increments
6. Click cart icon
7. Confirm cart drawer opens
8. Change quantity
9. Proceed toward checkout

## Inventory

- sold-out product cannot be added
- cart cannot bypass stock limits

## Admin product flow

- admin login
- create product
- edit product
- update stock
- archive product

## Admin order flow

- open paid order
- mark processing
- mark shipped
- verify expected state update

Email provider can be mocked/test-mode in E2E where appropriate.

## Review flow

- valid review token loads purchased product
- review can be submitted
- review becomes pending
- invalid token is rejected

---

# 82. Stripe Testing

Use Stripe test mode in development/staging.

Test at minimum:

- successful card payment
- enabled Swedish payment methods where Stripe test support allows
- payment failure
- duplicate webhook delivery
- checkout expiration
- refund synchronization
- partial refund synchronization where supported
- idempotent event processing

Do not test payments using live cards during normal development.

---

# 83. Email Testing

Development/test environments must not accidentally email real customers.

Use safe recipient handling/test configuration during development.

Test:

- order confirmation rendering
- shipped email rendering
- review link rendering
- idempotent email sends

---

# 84. Staging / Preview

Maintain separation between:

- development
- preview/staging
- production

Vercel previews are appropriate.

Production Stripe and test Stripe credentials must never be mixed.

Production database must not be reused as the normal local development database.

---

# 85. Database Backups

Production PostgreSQL provider must support reliable backups/recovery.

Before launch verify:

- backup configuration
- retention
- recovery process
- database access controls

Orders and historical financial records must not rely on one unrecoverable database instance.

---

# 86. Logging

Use structured server logging where useful.

Log events such as:

- failed checkout creation
- webhook processing failures
- email send failures
- reservation cleanup failures

Do not log secrets or excessive customer personal data.

Production logs should be useful for debugging without becoming a sensitive-data dump.

---

# 87. Accessibility

Aim for good WCAG-conscious UI.

At minimum:

- keyboard navigation
- visible focus states
- semantic buttons/links
- labels for inputs
- sufficient contrast
- alt text
- accessible cart drawer
- accessible dialogs
- Escape closes drawer where appropriate
- focus management when drawer opens/closes
- stars/review rating usable without mouse

Do not sacrifice accessibility for minimalist aesthetics.

---

# 88. Initial Route Architecture

Exact internal folder layout may evolve, but use a clear structure.

Conceptual routes:

Public:

- `/`
- `/pokemon-tcg`
- `/kategori/[slug]`
- `/set/[slug]`
- `/pokemon-tcg/[productSlug]`
- `/sok`
- `/review/[token]`
- legal/information pages

Admin:

- `/admin/login`
- `/admin`
- `/admin/products`
- `/admin/products/new`
- `/admin/products/[id]`
- `/admin/categories`
- `/admin/sets`
- `/admin/orders`
- `/admin/orders/[id]`
- `/admin/reviews`
- `/admin/users`
- `/admin/settings`

API/handlers as required:

- checkout creation
- Stripe webhook
- upload handling
- auth
- secure mutations

Avoid unnecessary REST endpoints when Server Actions are simpler and safe.

Stripe webhooks require an appropriate route handler.

---

# 89. Suggested Source Structure

Use a structure roughly like:

src/
  app/
    (store)/
    admin/
    api/

  components/
    store/
    admin/
    ui/

  lib/
    auth/
    db/
    stripe/
    email/
    storage/
    seo/
    validation/

  server/
    services/
    repositories-or-data/
    domain/

  types/

prisma/
  schema.prisma
  migrations/
  seed.ts

tests/
  ...

e2e/
  ...

Exact naming may change if there is a clear improvement.

Keep business logic out of giant React components.

---

# 90. Server/Client Boundaries

Use Server Components by default.

Client Components should mainly be used for interaction such as:

- cart state
- cart drawer
- quantity selectors
- interactive admin forms where needed
- image upload UI
- review stars

Database/Stripe/Resend code must never be imported into browser bundles.

---

# 91. Storefront State

Do not introduce a heavy global-state architecture without a need.

Cart state may use a small dedicated client-state solution or a carefully implemented React store.

Persistence to browser storage is required.

Keep source-of-truth commerce validation server-side.

Document the chosen cart state approach.

---

# 92. Site Settings and Caching

Store settings, categories and sets may be cached appropriately.

Changing an admin-managed value that affects public content must eventually invalidate/revalidate relevant pages.

Do not require redeploying the application just to:

- change product stock
- change price
- publish product
- change category content
- change shipping price

---

# 93. Product Publishing

A DRAFT product must not appear in:

- storefront listings
- sitemap
- public search

unless viewed through a future explicit preview mechanism.

ACTIVE product is publicly discoverable.

COMING_SOON can have a public page if intentionally published but must not be purchasable unless preorder is enabled.

ARCHIVED should not appear in normal product listing/search.

Decide whether archived product URLs remain available for SEO/history or return a redirect/404 based on the specific product lifecycle.

Avoid deleting useful URLs without thought.

---

# 94. Preorders

The data model must support preorders.

V1 minimum fields:

- isPreorder
- releaseDate

If a product is an active preorder:

- storefront clearly labels it as preorder
- release date is clearly displayed where known
- customer is not misled into believing immediate dispatch

Do not build advanced split-shipment preorder logic unless required.

If an order contains preorder + immediately available products, the initial business behavior must be clearly defined before enabling that combination in production.

Safe V1 approach may restrict mixed fulfillment if needed.

Document the final behavior.

---

# 95. Out of Scope for V1

Do NOT expand scope unnecessarily.

Not required in V1:

- customer accounts
- customer password system
- wishlists
- loyalty points
- referral programs
- complex coupon engine
- gift cards
- automated abandoned-cart email
- automated restock alerts
- international shipping
- multiple currencies
- multiple languages
- full PostNord API
- warehouse management system
- custom refund UI
- advanced accounting integration
- Algolia/Elasticsearch
- marketplace functionality
- auction functionality
- live chat
- native mobile application

Architectural choices should not deliberately prevent these later, but do not build them now.

---

# 96. Initial Seed Data

Development should have useful seed data.

Include:

- OWNER development admin
- categories
- several Pokémon sets
- sample sealed products
- products with different stock levels
- sold-out example
- coming-soon example
- preorder example
- approved and pending example reviews where useful

Never seed production credentials from development defaults.

Production OWNER creation needs a secure bootstrap process.

---

# 97. Development Admin Bootstrap

Provide a documented, safe way to create the first OWNER.

This must not expose a public signup route.

Possible approaches:

- secure CLI/bootstrap script
- one-time protected setup flow disabled after use

Prefer the simplest secure implementation.

Document exactly how the production owner is initially created.

---

# 98. HeavyCards Logo

Use the official supplied HeavyCards logo asset.

Expected project location can be something such as:

`/public/brand/heavycards-logo.*`

Do not redesign, trace or replace the company logo automatically.

If the asset is not present when implementation reaches the branding phase:

- create the layout so the asset can be dropped in
- use a temporary text-only HeavyCards placeholder
- report that the actual logo asset is missing

Do not invent a fake permanent logo.

---

# 99. UI Language

All customer-facing UI is Swedish.

Admin UI should also be Swedish.

Examples:

- Lägg i kundvagn
- Tillagd
- Till kassan
- Din kundvagn
- Slutsåld
- Förbeställ
- I lager
- Markera som skickad
- Produkter
- Beställningar
- Recensioner
- Inställningar

Code, variable names, database model names and technical documentation should use English.

---

# 100. Error Copy

Customer errors must be understandable Swedish.

Examples:

`Produkten finns inte längre i lager.`

`Det valda antalet finns inte tillgängligt.`

`Det gick inte att starta betalningen. Försök igen.`

Admin errors should also be understandable but may include safe operational detail.

Do not expose raw provider errors.

---

# 101. Milestone-Based Implementation

Do not attempt to build the entire application in one uncontrolled pass.

Work milestone by milestone.

Each milestone must:

1. implement the scoped work
2. add/update tests
3. run required checks
4. fix failures
5. update documentation if architecture changed
6. report what was completed
7. report any deviations from PROJECT.md

Do not silently reinterpret major business requirements.

---

# 102. Milestone 1 — Repository Foundation

Implement:

- Next.js
- TypeScript
- App Router
- Tailwind
- base shadcn/ui setup if used
- lint
- formatting
- Vitest
- Playwright base config
- environment validation
- `.env.example`
- basic folder structure
- initial README
- npm scripts
- pinned dependencies
- Node engine

Add a basic:

- homepage
- health endpoint or health mechanism if useful

Acceptance:

- install succeeds
- build succeeds
- lint succeeds
- typecheck succeeds
- tests succeed

---

# 103. Milestone 2 — Database Foundation

Implement:

- PostgreSQL integration
- Prisma
- initial schema
- migrations
- seed data

Initial relevant models should include at least the equivalents of:

- Product
- ProductImage
- Category
- PokemonSet
- Order
- OrderItem
- InventoryReservation
- Review
- ReviewToken
- AdminUser
- AuditLog
- StripeEvent
- Redirect
- StoreSettings

Auth-library-specific models may also be needed.

Do not add fields just because they might theoretically be useful.

Acceptance:

- fresh DB can migrate from zero
- seed works
- Prisma client works
- tests exist for important domain helpers

---

# 104. Milestone 3 — Storefront Design Foundation

Implement:

- HeavyCards visual system
- typography
- layout
- header
- footer
- responsive navigation
- cart icon placeholder/state integration
- shared buttons/forms/cards
- public page shell

Use official logo if available.

Acceptance:

- mobile and desktop layouts work
- no major accessibility violations
- branding matches project direction

---

# 105. Milestone 4 — Catalog

Implement:

- homepage data sections
- product listing
- category pages
- set pages
- product page
- search
- filters
- sorting
- stock labels
- coming-soon state
- preorder display

Acceptance:

- only publishable products appear
- inventory states are correct
- pages render without client-side-only content dependency
- basic SEO metadata exists from first implementation

---

# 106. Milestone 5 — Cart

Implement:

- persistent guest cart
- add/remove
- quantity change
- cart badge
- right-side cart drawer
- cart calculations for display
- server validation preparation

Hard UX requirements:

- cart drawer must NOT open automatically on add
- add button temporarily shows `TILLAGD`
- cart badge updates
- cart icon subtly animates

Acceptance:

- Playwright covers expected add-to-cart behavior
- refresh retains cart
- mobile drawer works
- keyboard/focus behavior works

---

# 107. Milestone 6 — Admin Authentication

Implement:

- secure admin auth
- OWNER
- ADMIN
- protected routes
- server-side authorization helpers
- secure initial owner bootstrap
- no public registration
- admin invite flow if included at this milestone

Acceptance:

- unauthenticated admin access blocked
- ADMIN/OWNER permission tests exist
- last OWNER cannot be accidentally removed
- password/session security documented

---

# 108. Milestone 7 — Product Administration

Implement:

- product list
- create
- edit
- archive
- publish
- inventory editing
- categories
- Pokémon sets
- image upload/reorder
- SEO fields
- audit logs for important changes

Acceptance:

- normal store management requires no Prisma access
- server validation exists
- image validation exists
- public catalog reflects changes correctly

---

# 109. Milestone 8 — Checkout and Inventory Reservation

Implement:

- authoritative server-side cart validation
- inventory reservation
- shipping calculation
- Stripe Checkout creation
- pending order creation
- Stripe identifiers
- reservation expiration strategy

Acceptance:

- client cannot alter authoritative price
- insufficient stock is rejected
- concurrent purchase protection is tested
- abandoned reservation eventually releases

---

# 110. Milestone 9 — Stripe Webhooks and Orders

Implement:

- webhook signature verification
- StripeEvent idempotency
- successful payment flow
- async flow where applicable
- checkout expiration
- refund synchronization
- partial refund synchronization
- final inventory handling

Acceptance:

- duplicate webhook does not duplicate stock/email/order changes
- paid order becomes PAID exactly once
- refund state stays synchronized
- inventory is concurrency-safe

---

# 111. Milestone 10 — Transactional Email

Implement:

- Resend integration
- order confirmation
- shipped email
- email idempotency
- HeavyCards email branding

Acceptance:

- successful payment sends one confirmation
- duplicate webhook does not send duplicate confirmation
- SHIPPED transition sends exactly one shipping email
- review link can be included in shipping email when available

---

# 112. Milestone 11 — Verified Reviews

Implement:

- review token generation
- token hashing
- expiration
- secure review route
- order-item eligibility
- review submission
- moderation
- verified-purchase indicator
- aggregate ratings from APPROVED reviews only

Acceptance:

- cannot review unpurchased product as verified
- duplicate review for same purchased product blocked
- invalid/expired token handled safely
- admin can approve/reject
- approved review appears publicly

---

# 113. Milestone 12 — Admin Orders and Dashboard

Implement:

- dashboard metrics
- recent orders
- low stock
- pending reviews
- order list
- order detail
- fulfillment transitions
- tracking field
- Stripe payment link/action
- audit history

Acceptance:

- admin can operate normal order workflow
- status transitions are validated
- shipping email integration works

---

# 114. Milestone 13 — SEO Completion

Complete:

- titles
- meta descriptions
- canonicals
- dynamic sitemap
- robots
- JSON-LD
- breadcrumbs
- redirects
- Open Graph
- alt text
- noindex rules
- crawlable categories/sets
- duplicate URL controls
- performance optimization

Acceptance:

- important pages have valid metadata
- sitemap excludes private routes
- structured data reflects visible reality
- slug changes preserve old URLs
- Lighthouse/Core Web Vitals are reviewed

---

# 115. Milestone 14 — Hardening and E2E

Expand:

- Playwright coverage
- security checks
- error handling
- accessibility
- responsive edge cases
- empty states
- loading states
- production logging
- concurrency edge cases

Test:

- no stock
- last unit
- duplicated webhook
- expired checkout
- failed payment
- full refund
- partial refund
- email retry
- invalid review token
- unauthorized admin action

---

# 116. Milestone 15 — Production Deployment

Prepare:

- Vercel project
- production PostgreSQL
- database backups
- production Stripe
- Stripe webhook endpoint
- Swish/Klarna/card configuration
- production Resend domain
- product image storage
- production environment variables
- first OWNER
- Search Console
- legal content review
- smoke testing

Never enable production payments before completing a production checklist.

---

# 117. Required npm Scripts

Provide sensible scripts such as:

- `dev`
- `build`
- `start`
- `lint`
- `typecheck`
- `test`
- `test:watch`
- `test:e2e`
- database migration helpers
- seed helper

Do not create ten redundant aliases for the same command.

---

# 118. Definition of Done — Feature Level

A feature is not done merely because the UI exists.

For relevant features, Done means:

- TypeScript types are correct
- server validation exists
- permissions are correct
- loading/error/empty states exist
- mobile works
- important tests exist
- accessibility considered
- no obvious security issue
- no secrets are exposed
- no console errors
- lint passes
- typecheck passes
- relevant tests pass

---

# 119. Definition of Done — Milestone Level

Before reporting a milestone as complete, run:

- install/build sanity where relevant
- lint
- typecheck
- Vitest
- relevant Playwright tests

If a check cannot run due to missing third-party credentials:

- clearly say so
- test everything possible locally
- do not claim full success

---

# 120. Agent Operating Rules

Read this entire PROJECT.md before changing files.

Do not skip directly to Stripe or UI implementation.

Work in milestone order unless there is a documented technical dependency requiring a small adjustment.

Before each milestone:

1. inspect the current repository
2. understand existing implementation
3. state the intended changes internally
4. implement cleanly
5. test

Do not repeatedly rewrite stable working architecture without cause.

---

# 121. Do Not Invent Business Decisions

If PROJECT.md explicitly defines behavior, follow it.

Examples:

- Swedish customers only
- SEK
- guest checkout
- Stripe
- Swish/Klarna/cards
- cart drawer opens manually
- add-to-cart does not open drawer
- shipping email on SHIPPED
- refunds handled in Stripe Dashboard
- multiple admin users
- SEO is a priority
- review links are secure and verified-purchase based

Do not silently replace these with preferred alternatives.

---

# 122. Reasonable Engineering Autonomy

The coding agent may choose low-level implementation details when PROJECT.md does not prescribe them.

Examples:

- exact helper function names
- exact component file splits
- exact repository/service naming
- minor UI spacing values
- exact test factory pattern

For significant choices, prefer:

- simple
- maintainable
- typed
- documented
- production-safe

Avoid unnecessary abstractions.

---

# 123. Avoid Overengineering

Do not introduce:

- microservices
- event buses
- Kafka
- Redis unless actually required
- CQRS
- complex DDD frameworks
- GraphQL merely for fashion
- custom payment infrastructure
- custom ORM

This store should remain understandable to a small development team.

---

# 124. Code Quality

Prefer:

- small cohesive functions
- explicit types
- readable names
- clear server/client boundaries
- domain helpers for important rules
- reusable schemas
- limited duplication

Avoid:

- giant 800-line components
- `any`
- duplicated pricing logic
- duplicated authorization logic
- business logic embedded inside styling components
- hidden magic constants

Commercial values such as shipping thresholds should come from settings/configuration, not magic numbers.

---

# 125. Comments

Comment code when explaining:

- non-obvious business logic
- concurrency behavior
- security behavior
- external provider quirks

Do not comment obvious code line by line.

Documentation should explain why, not narrate syntax.

---

# 126. README Requirements

README should eventually document:

- project purpose
- technology stack
- local setup
- environment variables
- database setup
- migrations
- seed
- testing
- Stripe local webhook development
- email development setup
- admin bootstrap
- deployment overview

Never place real secrets in README.

---

# 127. Architecture Documentation

If implementation makes a meaningful decision not fully specified here, document it.

Examples:

- auth provider selected
- stock reservation transaction strategy
- storage provider
- caching/revalidation strategy
- final SEO route structure

Keep documentation concise and practical.

---

# 128. Production Safety

Before production launch verify:

- Stripe test mode is no longer being used accidentally
- webhook secret belongs to production endpoint
- database is production database
- backups exist
- email sender is verified
- admin accounts are secure
- temporary dev users removed
- seed demo products are removed or intentional
- legal pages reviewed
- customer support email correct
- shipping price correct
- free shipping threshold correct
- taxes/pricing reviewed by business owner
- robots does not block storefront
- admin is not indexable
- Search Console configured
- HTTPS works
- secrets are not in repository history

---

# 129. V1 Success Criteria

HeavyCards V1 is successful when a real Swedish customer can:

1. arrive from Google
2. browse a fast mobile-friendly store
3. find a relevant product
4. understand availability and price
5. add it to cart
6. receive clear cart feedback without interruption
7. open cart manually
8. checkout securely
9. pay using an enabled Stripe method
10. receive order confirmation
11. later receive a shipping confirmation
12. leave a verified product review

At the same time, HeavyCards staff can:

1. log into `/admin`
2. manage products
3. manage stock
4. manage categories and sets
5. see paid orders
6. move an order through fulfillment
7. mark it shipped
8. trigger the shipping email
9. moderate reviews
10. invite/use multiple admin accounts
11. manage the store without Prisma or source-code access

---

# 130. Final Product Principle

HeavyCards should feel simple to the customer and simple to the store owner even though the backend correctly handles complex areas such as:

- payments
- inventory
- concurrency
- reviews
- security
- SEO
- multiple administrators

Complexity should live behind clean interfaces.

Customer experience:

`Find product → Add → Cart → Pay`

Store owner experience:

`Login → Products / Orders / Reviews → Manage`

Developer experience:

`Typed application → Prisma → PostgreSQL → Stripe/Resend`

Do not expose infrastructure complexity to normal HeavyCards users.