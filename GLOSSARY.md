# Digi-Shop

This context covers the product catalog, customer orders, and their payment lifecycle through external payment providers.

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
