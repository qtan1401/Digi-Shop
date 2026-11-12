# Digi-Shop

This context covers the product catalog, customer orders and their payment lifecycle through external payment providers, buying without an account, the Vouchers customers redeem against orders, the Loyalty points they earn and spend, and the reviews customers leave on Products.

## Language

### Product catalog

**Product**:
A device model offered in the catalog, grouping one or more Product variants.

**Product variant**:
A specific sellable configuration of a Product, defined by its values for the applicable Product options. It has its own SKU, price, and stock.

**Product option**:
A named dimension of a Product that customers can use to distinguish its variants, such as Color or Size.

**Product option value**:
A possible choice within a Product option.

**SKU**:
A unique stock-keeping code identifying one Product variant.

**Brand**:
The maker's customer-facing identity associated with a Product.

**Device type**:
The broad class used to organize a Product in the catalog: phone, tablet, or laptop.
_Avoid_: Category

**Product catalog**:
The set of Products currently offered for browsing and purchase.

### Orders and payments

**Order**:
A customer's purchase, which remains the same order when the customer makes another payment attempt. An order can remain unpaid while an attempt expires.
_Avoid_: Payment transaction

**Payment attempt**:
One attempt to pay an order through a payment provider. A customer may create a new attempt for the same order after an earlier attempt expires.
_Avoid_: Order

**Expired payment attempt**:
A payment attempt that did not receive a valid successful result within five minutes. Expiring an attempt does not by itself confirm payment or cancel the order.
_Avoid_: Cancelled order

### Guest checkout

**Guest checkout**:
Placing an Order without signing in. The buyer gives an email; the Order is attached to the customer account of that email, which is created when there is none. Nobody is ever signed in by it, and nothing it returns says whether the account already existed.
_Avoid_: Anonymous order, unregistered purchase

**Guest account**:
A customer account that guest checkout created: no password, status UNVERIFIED, named after the first order's recipient. It becomes usable once its owner proves access to the mailbox, through the password link (or the verification link, or Google sign-in with the same email), and then shows every Order placed with that email.
_Avoid_: Shadow account, temporary account

**Password link**:
A single-use link to /reset-password.html, valid 30 minutes, emailed to a customer account. Only the SHA-256 of its token is stored (Password reset token); a newer link voids every earlier one. Opening it and choosing a password sets that password, clears the lock, signs every session out and, for a Passwordless account, activates it (the mailbox is proven). It never signs anyone in. The request for one always answers the same, whether or not the email has an account.
_Avoid_: Temporary password, reset code

**Passwordless account**:
A customer account with status UNVERIFIED and no password: created by Guest checkout or by registration (email, full name and shipping address only; the first address has no phone yet). It gets a password only through a Password link.
_Avoid_: Shadow account

**Guest access token**:
The random secret returned once in the guest checkout response. Whoever sends it (header `X-Guest-Order-Token`) may read and retry the payment attempts of that one Order; only its SHA-256 is stored on the Order. It is not a session and opens nothing else.
_Avoid_: Order password, session token

**Customer email**:
The email a guest typed at checkout, stored on the Order. The order confirmation goes to it. A signed-in Order has none and uses its owner's account email.

### Vouchers

**Voucher**:
A code issued by an administrator that a customer redeems on an Order to receive a Discount, valid only within its validity period.
_Avoid_: Coupon, promo code, promotion

**Percentage voucher**:
A Voucher whose Discount is a percentage of the Order's subtotal, limited by a maximum Discount amount.

**Free-shipping voucher**:
A Voucher whose Discount equals the Order's shipping fee.

**Legacy voucher**:
A Voucher that predates the 5-character code rule (a longer code) or whose end date already passed. The administrator still sees it, flagged as legacy; customers neither see nor can redeem it.

**Validity period**:
The span of time during which a Voucher can be redeemed.

**Voucher quantity**:
The number of Orders that may still redeem a Voucher. Each Order that redeems it uses one, and gives it back if the Order is cancelled or its payment does not complete.

**Unlisted voucher**:
A Voucher that is not shown in the checkout list and can only be redeemed by entering its code.

**Discount**:
The amount deducted from an Order by the Vouchers redeemed on it. It never changes the Product variant's price.
_Avoid_: Sale price, promotional price

### Loyalty points

**Loyalty points**:
The balance a customer earns on purchases and spends on later Orders. One point is worth 1.000 VND; there is no minimum, no expiry and no other restriction on using them.
_Avoid_: Reward points, coins, credit

**Points earned**:
The Loyalty points an Order grants: floor(10% of its total price / 1.000). Computed on the amount actually payable after the Discount and the Points discount. An Order with no account (a guest using an administrator's email) earns nothing. The figure is stored when the Order is placed but credited later, so unpaid orders never produce spendable points: a cash-on-delivery or bank-transfer Order earns them when it is delivered; an online (MoMo/VNPay) Order when its payment first succeeds (never on a late success), and one delivered while still unpaid earns nothing until paid. An administrator marking an Order PAID credits them too (once), and re-takes any Points redeemed that were given back, taking only what the balance holds. Cancelling the Order takes credited points back (the balance never goes below zero).

**Points redeemed**:
The Loyalty points a customer spends on an Order at checkout (`pointsToUse`). Only as many as the remaining payable amount needs are spent. They go back to the balance once if the Order is cancelled or its payment attempt expires or fails, and are taken again when the customer retries payment (which fails if the balance no longer covers them).

**Points discount**:
The amount deducted from an Order by the Points redeemed (1.000 VND each, never more than what is payable). Separate from the Discount, which is only the Vouchers' share: total price = subtotal + shipping fee - Discount - Points discount.
_Avoid_: Discount (for points)

### Tax

**Included VAT**:
The 10% VAT already contained in the catalogue prices, shown for information as round(subtotal x 10 / 110). It never changes an Order's total.
_Avoid_: Tax (as an extra charge), VAT surcharge

### Product reviews

**Product review**:
A customer's feedback on a Product, made of a Rating, a comment, or both. A customer is never required to leave one.
_Avoid_: Feedback, testimonial

**Rating**:
The one-to-five star score in a Product review.
_Avoid_: Score, stars

**Verified reviewer**:
A customer who has a delivered Order containing the Product, and is therefore allowed to review it.
_Avoid_: Buyer

**Username**:
A customer's unique public name, chosen once, shown with their Product reviews.

### Admin analytics and catalog media

**Cost price**:
What the shop pays for one unit of a Product variant. Entered by the admin, never shown to customers. Each Order line snapshots it as `unit_cost` at purchase time.
_Avoid_: Purchase price, import price

**Profit**:
For one Order that is not CANCELLED, the sum over its lines of (line total − unit cost × quantity), minus the voucher discount and the points discount. Overall profit adds this up over a period.
_Avoid_: Margin, earnings

**Product image**:
An extra gallery photo of a Product, kept in order by position. The main photo stays on the Product itself; every Product shows at least three photos in total.
_Avoid_: Picture, thumbnail

**Guest comment**:
A Product review written without signing in, carrying a typed display name and labelled "Khách". It has no Rating and cannot be edited or deleted by its author.
_Avoid_: Anonymous review

**Banned account**:
A customer account with status BANNED. It cannot sign in and any existing session is revoked; an admin can unban it. Admin accounts cannot be banned.
_Avoid_: Blocked, suspended

### Landing page and catalog

**Landing page**:
The shop's front page at `/`: a short introduction, the New products, the Best sellers and one strip of four Products per device type. It lists nothing in full; each group links to the Catalog page.
_Avoid_: Home catalog

**Catalog page**:
The page at `/catalog.html` (also `/danh-muc/<device type>` and `/the/<brand>`) that lists the whole Product catalog, 12 per page, filterable by device type, brand, price range and minimum rating, with the page number always shown.
_Avoid_: Home page

**New products**:
The eight Products with the latest creation time that are not deleted and still have an active variant.

**Best sellers**:
The eight Products with the most units sold (sum of order line quantities) in Orders that are not CANCELLED. Units sold in the last 90 days rank first; units sold at any time fill the list when fewer than eight sold recently.
_Avoid_: Top products, popular

**Minimum rating**:
A catalog filter (4 or 3 stars) that keeps Products whose average Rating, rounded to one decimal as the card shows it, is at least that number. A Product with no Rating never matches.

**Live review update**:
A message pushed over WebSocket to everyone viewing a Product when a Product review there is created, edited, deleted or hidden, carrying the public review and the Product's new rating figures. Only public data travels in it. Where the socket is down, the page falls back to reloading the reviews every 30 seconds.
_Avoid_: Notification, push

**Revenue**:
The total price of the Orders in a period that are PAID or DELIVERED and not CANCELLED. A pending or unpaid Order is counted as an order placed but never as Revenue, and a CANCELLED Order is left out of every dashboard figure. The period is read in shop time (UTC+7) with weeks starting on Monday. Profit and units sold are counted on the same Orders as Revenue.
_Avoid_: Sales, turnover, income

**Main photo**:
The photo kept on the Product itself, shown first (position 0). Product images follow it from position 1. Photos that belong to a Product variant (for example a colour) are shown alongside them, never instead of the Product images. Removing a Product image deletes its file only when an admin uploaded it; the sample catalog's photos stay on disk.
_Avoid_: Cover, thumbnail
