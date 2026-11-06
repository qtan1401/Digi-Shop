# Digi-Shop

This context covers the product catalog, customer orders and their payment lifecycle through external payment providers, the Vouchers customers redeem against orders, and the reviews customers leave on Products.

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

### Vouchers

**Voucher**:
A code issued by an administrator that a customer redeems on an Order to receive a Discount, valid only within its validity period.
_Avoid_: Coupon, promo code, promotion

**Percentage voucher**:
A Voucher whose Discount is a percentage of the Order's subtotal, limited by a maximum Discount amount.

**Free-shipping voucher**:
A Voucher whose Discount equals the Order's shipping fee.

**Validity period**:
The span of time during which a Voucher can be redeemed.

**Voucher quantity**:
The number of Orders that may still redeem a Voucher. Each Order that redeems it uses one, and gives it back if the Order is cancelled or its payment does not complete.

**Unlisted voucher**:
A Voucher that is not shown in the checkout list and can only be redeemed by entering its code.

**Discount**:
The amount deducted from an Order by the Vouchers redeemed on it. It never changes the Product variant's price.
_Avoid_: Sale price, promotional price

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
