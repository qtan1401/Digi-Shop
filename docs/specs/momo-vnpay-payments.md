## Problem Statement

Customers can currently choose only cash on delivery or a generic bank-transfer option. Digi-Shop has no integrated payment attempt, transaction-specific QR, verified provider callback, or automatic handling of an unpaid attempt's timeout. Customers need to pay online through production MoMo or VNPay while orders and inventory remain consistent when they abandon, retry, or complete payment late.

## Solution

Add MoMo and VNPay as online payment methods. For each payment attempt, create a provider-backed, order-specific QR that the customer scans to pay. Keep the order unpaid until a verified, timely provider callback confirms payment. Each attempt expires after five minutes. Expiration restores the reserved stock but leaves the same order pending and unpaid; the customer can create another attempt for that order if stock can be reserved again. A verified success received after attempt expiration is recorded for reconciliation and MUST NOT automatically mark the order paid.

## User Stories

1. As a customer, I want to select MoMo at checkout, so that I can pay using MoMo.
2. As a customer, I want to select VNPay at checkout, so that I can pay using VNPay.
3. As a customer, I want a unique QR for each payment attempt, so that my payment is linked to the correct order and attempt.
4. As a customer, I want to see the amount, provider, order reference, and five-minute expiry while viewing a QR, so that I know what I am paying and how long the attempt is valid.
5. As a customer, I want the checkout to show payment as pending until the provider confirms it, so that an unverified browser return is not mistaken for payment.
6. As a customer, I want the checkout to update when payment is confirmed, so that I know whether the order was paid without relying on a redirect alone.
7. As a customer, I want to see that an unpaid attempt expired, so that I understand why its QR can no longer be used.
8. As a customer, I want to retry payment on the same unpaid order after expiry, so that I do not need to recreate my order.
9. As a customer, I want a retry to reserve stock only when it is still available, so that Digi-Shop does not accept payment for unavailable items.
10. As a customer, I want COD to remain available, so that the existing pay-on-delivery checkout continues to work.
11. As a store operator, I want inventory reserved when a payment attempt starts and restored when it expires, so that unpaid QR attempts do not permanently consume stock.
12. As a store operator, I want successful callbacks to be authenticated and checked against the provider, attempt, order, amount, and currency, so that forged or mismatched notifications cannot mark an order paid.
13. As a store operator, I want repeated provider callbacks to be idempotent, so that retries from a provider cannot duplicate stock or payment state changes.
14. As a store operator, I want a valid success received after an attempt expired recorded for reconciliation without auto-confirming the order, so that late money movement is visible without authorizing fulfillment.
15. As a store operator, I want callback failures and invalid signatures rejected without changing order or stock state, so that invalid provider traffic is harmless.
16. As a store operator, I want provider credentials and callback configuration supplied through deployment configuration, so that secrets are not exposed in source control or browser code.
17. As a store operator, I want the system to create attempts against production MoMo and VNPay endpoints, so that customers can make real payments after deployment is configured.
18. As a store operator, I want payment attempts and their provider references retained with the order, so that I can audit normal, expired, retried, and late-success cases.

## Implementation Decisions

- Preserve the existing order as the customer purchase; represent each provider payment try as a separate Payment attempt associated with that order. A new attempt does not create a new order.
- Preserve the existing `PENDING` order and `UNPAID` payment state until a verified success for a non-expired attempt is accepted. Use explicit per-attempt states and expiry timestamps rather than overloading the order payment status.
- Expire an attempt after five minutes. Restore its reserved stock exactly once, keep the order pending/unpaid, and permit another attempt only after atomically rechecking and reserving all order-item quantities. Expiration and provider callbacks must be concurrency-safe.
- A verified provider success received after expiration is retained as a late-success/reconciliation outcome and does not automatically change the order to paid or authorize fulfillment. Refund execution is out of scope.
- Use provider-specific adapters behind a shared payment service boundary. Generate a provider transaction and QR for every attempt. Verify provider signatures and reconcile provider transaction reference, local attempt, order, amount, and currency before accepting a callback.
- Make callback processing idempotent. Invalid or mismatched callbacks cannot mutate order/payment/stock state. Browser redirects or client requests never constitute payment confirmation.
- Keep COD and existing BANKING behavior. Add MoMo and VNPay as additional checkout choices; existing orders and clients using BANKING remain compatible.
- Expose authenticated customer operations to start an attempt, retry an expired attempt on the same owned unpaid order, and retrieve current order/attempt status. Expose public provider callback endpoints that validate signatures independently of browser authentication.
- Return only safe customer-facing QR/payment data from attempt creation; provider secrets and signing material remain server-side.
- Configure production credentials, merchant identifiers, callback/public URLs, and provider settings through environment configuration. Never commit credentials. Sandbox deployment is not required by the product request; provider verification during development must avoid accidentally initiating real charges.
- Implement expiry as server-owned behavior that still runs when a customer closes the browser. Persist expiration timestamps and ensure one expiration transition per attempt.
- Continue using the existing checkout and order persistence boundaries where possible. Persist payment attempts and the inventory reservation/expiration transition transactionally with existing SQL Server/Prisma data.

## Testing Decisions

- Test through the public Express API/application seam with provider HTTP calls replaced at the outbound network boundary. Assert externally visible order, attempt, QR, and stock behavior; do not pin internal adapter calls or copied payloads.
- Cover successful MoMo and VNPay attempt initiation, a unique attempt/QR for retries, verified success changing an unpaid order to paid, and repeated callbacks remaining idempotent.
- Cover five-minute expiration restoring stock once while leaving the order pending/unpaid; retry succeeding when stock is available and failing without creating a live attempt when it is not.
- Cover callbacks with invalid signatures, mismatched amount/reference/order, expired-attempt success, and callback/expiration races; assert no incorrect order transition or duplicate inventory change.
- Exercise the customer-facing QR/pending/expired/retry states with a smoke run of the actual checkout surface.
- Verification uses `npm test` (`node --test`) with deterministic Express API tests, fake persistence, and provider-network mocks. The actual checkout page was browser-smoke-tested with stubbed API responses. No production merchant transaction or callback was performed.

## Out of Scope

- Refund execution and automated refund workflows.
- Sandbox as a required deployment target.
- Adding other online payment providers or payment methods.
- Treating provider browser redirects as authoritative confirmation.
- Automatically confirming or fulfilling an order from a success callback received after its payment attempt expired.
- Replacing existing order identity or creating a new order for each retry.

## Further Notes

- The current checkout creates `PENDING`/`UNPAID` orders while decrementing stock, accepts COD and BANKING, and has no payment-attempt or callback model. Payment expiry therefore requires a new persisted lifecycle and a stock-restoration path.
- No production credentials or public callback origin are present in the repository's example configuration. Deployment must supply valid provider credentials and publicly reachable HTTPS callback URLs before real payments can be enabled.
- MoMo's `qrCodeUrl` is QR payload, not an image; render it as a QR image. Production access to that field must be enabled for the merchant. VNPay's official PAY flow uses a hosted payment URL with `VNPAYQR`, where VNPay displays the unique QR; do not invent a merchant-side QR payload from the hosted URL.
