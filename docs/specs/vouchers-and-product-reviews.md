## Problem Statement

Digi-Shop orders already carry a `discount` column, but every checkout path writes `discount: 0` and nothing can reduce what a customer pays. Customers also have no way to see how other buyers rate a Product before choosing it, and administrators cannot create promotions or see customer feedback.

## Solution

Add **Vouchers** (administrator-issued codes redeemed on an Order for a Discount) and **Product reviews** (a Rating and/or a comment from a Verified reviewer), plus the supporting changes they require: a required Username at registration, seed data for local inspection, and the administrator and customer screens.

Terms are defined in `GLOSSARY.md`; this document does not redefine them.

## Decisions (settled in the design interview)

### Vouchers

- Two types only: **Percentage voucher** (percent of the Order subtotal, with a maximum Discount) and **Free-shipping voucher** (Discount equals the shipping fee). No fixed-amount vouchers.
- Any single Voucher yields at most **500,000 VND** of Discount. Administrators cannot configure more.
- Administrator creates and edits Vouchers: code (3-20 letters/digits, case-insensitive, unique), description, type, percent (1-100 integer), maximum Discount (1,000-500,000 VND), validity period (end after start), **quantity**, enabled flag, and a **listed** flag (default on).
- Percent, maximum Discount and type cannot be edited once a Voucher has been redeemed. Quantity can be raised any time but never below the number already redeemed. A redeemed Voucher cannot be deleted, only disabled. Create, edit and disable write audit log entries.
- No per-account limit and no minimum order value.
- Redemption rules for one Order (all checked server-side, in one pure function):
  1. A Voucher is used at most once per Order.
  2. At most **3** Vouchers per Order; at most **one** Free-shipping voucher.
  3. Every Percentage voucher is computed on the **original subtotal**, never on a reduced amount, so result does not depend on the order they were applied. Whole VND, rounded down. Each is capped by its own maximum Discount.
  4. Discount on goods never exceeds `subtotal`; a Free-shipping voucher's Discount never exceeds `shippingFee`.
  5. Total Discount per Order is capped at **1,000,000 VND**.
  6. `totalPrice` never drops below **1,000 VND** (the MoMo minimum). When a rule would be crossed, the Discount is **reduced**, never the Order rejected. Reductions are taken from the last Voucher backwards so each Voucher's recorded amount still sums exactly to `Order.discount`.
  7. `totalPrice = subtotal + shippingFee - discount`, and is never negative.
- **Quantity** is used when an Order is created (in the same transaction that decrements stock) and given back when the Order is cancelled or a payment attempt expires or fails. Paying again re-uses a lot, and **fails** when the Voucher is out of quantity or disabled (validity dates are not re-checked, the Discount was fixed at creation).
- If a Voucher is no longer valid when the customer pays, checkout is **blocked** with a message naming the Voucher; it is never silently dropped.
- Vouchers apply to both checkout paths (buy now and cart). The Discount is computed by one shared function.
- Customers choose from a list of applicable listed Vouchers (code, short description, expiry, the Discount it would give this cart; **not** the remaining quantity) and can also type a code. Unlisted Vouchers work only by typing the code. A wrong or inapplicable code gets one sentence with the exact reason. The selected codes live in `sessionStorage` only.
- The Order stores a **snapshot** per Voucher (code, type, percent, Discount amount) so later edits do not rewrite history.

### Product reviews

- Only a **Verified reviewer** (has a `DELIVERED` Order containing the Product) may write one. One review per customer per Product. A review has a Rating (1-5), a comment (max 1,000 characters) or both. Customers are never forced to review.
- Customers can edit and delete their own review. Administrators can **hide** and unhide any review (flag, row kept). Hidden or deleted reviews are excluded from every number.
- The average uses Ratings only; a comment-only review is shown but not counted in the average.
- The reviewer name shown is the customer's **Username**.
- **Username** is required when registering with email. Existing customers and first-time Google users have none: they are asked for one only when they first try to write a review. Once set it cannot be changed in this release.
- Shown on the product card (average and count, hidden when there are no Ratings) and on the detail page (summary, 5-1 star distribution, newest-first list, 5 per page, write/edit form, or a hint when not eligible). No catalog filter or sort by rating.

## Data model

| Table | Columns (new) |
| --- | --- |
| `vouchers` | id, code (unique, case-insensitive), description, type (`PERCENT`/`FREE_SHIPPING`), percent null, max_discount null, starts_at, ends_at, quantity, redeemed_count, is_enabled, is_listed, created_at, updated_at. Check: `redeemed_count <= quantity`. |
| `order_vouchers` | order_id, voucher_id, code_snapshot, type_snapshot, percent_snapshot, discount_amount, released_at null. Unique `(order_id, voucher_id)`. `released_at` makes give-back idempotent. |
| `product_reviews` | id, product_id, user_id, rating tinyint null (1-5), comment nvarchar(1000) null, is_hidden, created_at, updated_at. Unique `(product_id, user_id)`. Check: rating or comment present. |

`users.username` already exists (unique when set, nullable); no constraint blocks customers from having one. New tables are added to `CLEAR_TABLES` in `prisma/seed.js`, children before parents.

## Slices

Each slice is separately runnable and verifiable. Slices 2-4 can run in parallel after slice 1.

1. **Schema and migration.** Add the three tables; extend `schema.prisma`, add one migration, and register the tables in `CLEAR_TABLES`. Verify: migrate, generate, and the existing integration tests still pass.
2. **Voucher backend.**
   - Pure `calculateDiscount` (rules 1-7) with table-driven `node:test` cases: negative totals, Discount larger than the cart, three 500,000 vouchers on a cheap cart, two Free-shipping vouchers, percent above 100, rounding, floor at 1,000.
   - Voucher repository and administrator routes (CRUD, audit log).
   - Checkout: lock Vouchers in id order inside the existing checkout transaction, validate, write `order_vouchers`, increment `redeemed_count`, set `discount` and `totalPrice`, in both `processCheckout` and `processCartCheckout`.
   - `POST /api/vouchers/quote` for the cart/checkout screens (same function, no reservation).
   - Give back on payment attempt release (`releaseAttempt`) and on administrator cancel; re-reserve in `createRetryAttempt`.
   - Verify: concurrent last-quantity checkout (one wins), cancel gives back exactly once, retry blocked when out of quantity.
3. **Review backend.** Eligibility query (`OrderItem -> ProductVariant -> productId`, Order `DELIVERED`), create/update/delete own, list with paging, administrator hide/unhide, `ratingAverage` and `ratingCount` added to product list and detail responses (also used by the server-rendered `/danh-muc/*` and `/the/*` pages through `renderProductCard`). Verify: ineligible customer rejected, one review per Product, hidden review leaves the average.
4. **Username.** Required at email registration with uniqueness and character rules; set-once endpoint for accounts without one; the login form already accepts a username.
5. **Administrator screens** (ui-ux skill, branch U): Voucher list and create/edit modal, review moderation list, Order detail shows subtotal, shipping, Discount with each code, total. Sidebar grows to six items.
6. **Customer screens** (ui-ux skill, branch U): Voucher picker plus code field at checkout (cart and buy-now), stars on cards, review block on the detail page, username field on registration and the inline username prompt before a first review.
7. **Seed** (extend `commerce` in `prisma/seed-data.js`, which already has an empty `orders` array and an idempotent insert path): about 12 customers (usernames, `@seed.local` emails, no password), about 40 `DELIVERED` Orders 7-90 days old plus 6-8 recent Orders in other states (including one `PENDING` over 24 hours), some using seeded Vouchers, 3-8 Product reviews per Product skewed to 4-5 stars with Vietnamese comments, and Vouchers in every state (active, expiring soon, expired, disabled, out of quantity, unlisted). Fixed pseudo-random seed so reruns insert nothing new. Seeded Orders do not change stock and have no payment attempts.

## Out of scope

Fixed-amount Vouchers, per-account limits, minimum order value, product-scoped Vouchers, review photos, filtering or sorting by rating, changing a Username, and restoring stock when an administrator cancels an Order (existing gap, noted below).

## Known risks to check during slice 2

- Administrator cancel (`order.service.js`) does **not** restore stock today; only `releaseAttempt` does. Voucher give-back on cancel must not be coupled to that gap.
- Confirm what the `LATE_SUCCESS` payment path does after an attempt was released: stock is not decremented again there, so a Voucher must not be silently re-used either.
- The Overview screen counts every Order in revenue and daily charts; seeded Orders will visibly change those numbers (accepted for local use).
