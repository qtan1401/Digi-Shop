# Online payments

Digi-Shop supports online MoMo and VNPay QR payments in addition to COD. Online payment attempts last five minutes. A verified callback before expiry marks the order paid; expiration releases reserved stock while the order stays pending and unpaid. A retry creates another attempt on the same order after inventory is rechecked.

If a provider cannot start a payment, the order remains pending and unpaid, the failed attempt is retained, and its stock reservation is released for a same-order retry.

## Production configuration

Set these server-side variables; never place provider credentials in browser code or source control:

- `APP_ORIGIN`: comma-separated application origins shared with authentication. It MUST contain exactly one public HTTPS origin (no path); payment callbacks and return URLs use that origin. Extra `http://localhost:3000` entries are ignored by payments.
- `PAYMENT_ENV`: set to `sandbox` to use MoMo's test API (`test-payment.momo.vn`) and VNPay's sandbox (`sandbox.vnpayment.vn`) with test credentials; any other value or unset means production. In sandbox mode `VNPAY_PAY_URL` is ignored.
- `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`: MoMo production credentials.
- `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`: VNPay production credentials.
- `VNPAY_PAY_URL`: production payment URL; use `https://pay.vnpay.vn/vpcpay.html`.
- `VNPAY_IPN_URL`: the public HTTPS URL `${APP_ORIGIN}/api/payments/vnpay/ipn`.

MoMo's IPN URL is `${APP_ORIGIN}/api/payments/momo/callback`. Configure that URL with MoMo as part of the merchant setup. MoMo must grant this merchant permission to receive `qrCodeUrl`; otherwise a MoMo QR attempt is rejected and its stock reservation is released.

MoMo supports VND 1,000–50,000,000 per payment. Larger orders cannot receive a MoMo QR; the failed attempt releases its stock reservation, and the customer can retry the same order with VNPay.

VNPay's PAY integration creates a signed hosted payment URL with `vnp_BankCode=VNPAYQR`. Digi-Shop also displays a QR containing that URL for opening the payment page on another device. This is a link QR, not a direct bank-payment QR; payment still happens on VNPay's hosted page, which must support VNPAYQR for the merchant. Register the IPN URL in the VNPay merchant portal. Configure the public HTTPS `APP_ORIGIN` and IPN URL before accepting payments.

When deployed behind a reverse proxy (for example Railway), set `TRUST_PROXY` to the number of proxy hops (usually `1`) so VNPay receives the customer's IP address. Unset means no proxy is trusted; only set it when a proxy really sits in front of the app, otherwise clients can spoof their IP.

Apply the database migration and regenerate Prisma Client before starting the application. The server sweeps expired payment attempts in the background; payment status polling also expires an overdue attempt immediately.

## Late successful notifications

A successful notification for an already expired or failed attempt is stored as `LATE_SUCCESS`. It does not set the order to `PAID` or authorize fulfillment. Admins can review these attempts at `GET /api/payments/reconciliation` and handle the provider-side payment manually. Automated refunds are not implemented.
