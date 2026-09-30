# Local store reset and seeding

`npm run db:seed` is the repeatable, non-destructive seed operation. It initializes the configured `admin123` administrator and the fixed Apple/Samsung/MSI and phone/tablet/laptop vocabulary. It inserts no sample Products and never deletes existing records.

## One-time local reset

The reset is a distinct destructive operation. It is not run by application startup, `db:seed`, `db:setup`, or database migrations. Back up and verify the intended local database before proceeding.

For deployments applying the Product taxonomy migration, schedule the separately confirmed reset in a maintenance window: apply the migration first, keep the updated storefront unavailable, then run and verify `npm run db:reset:local` before exposing the updated storefront. The migration preserves legacy Product and category rows; those rows remain in the database until the explicit reset, which clears them along with the other records listed below.

1. Configure the normal SQL Server environment and verify `DB_SERVER=localhost`, `DB_PORT=1433`, and `DB_NAME=DigiShop` (the command rejects all other targets).
2. Set a fresh, private `ADMIN_DEFAULT_PASSWORD` value of at least 16 characters in the operator's environment. Do not commit it or reuse a disclosed password.
3. Set `STORE_RESET_CONFIRMATION` to the exact text `RESET LOCAL DIGISHOP`.
4. Explicitly run `npm run db:reset:local`.

The command reports the database target plus before/after counts for every cleared table; it does not print the configured password. It deletes payment attempts before Orders, order items before Orders, cart references before Products, and user-linked authentication/cart data before Users. It also clears legacy category rows retained by the non-destructive Product migration. All clearing happens in one serializable transaction. The command nulls refresh-session replacement links before deleting sessions to satisfy the self-reference constraint. It creates the replacement `admin123` only within that transaction after clearing; its password is hashed and first login requires changing it. If any step fails, deletion and administrator creation roll back together.

## Non-destructive rollback verification

To exercise the exact table-clearing and administrator-creation transaction without a committing path, set `STORE_RESET_ROLLBACK_CONFIRMATION=ROLLBACK CHECK LOCAL DIGISHOP` and run:

```sh
npm run db:reset:rollback-check
```

This command accepts only the same `localhost:1433` / `DigiShop` target and requires `ADMIN_DEFAULT_PASSWORD`. It snapshots counts for all 13 tables in the reset list, performs the clear and administrator creation inside a serializable transaction, then unconditionally rolls the transaction back before querying counts again. It reports before/after counts and fails unless they match. It has no option to commit; use the separately confirmed `db:reset:local` command only when an actual destructive reset is intended.

| SQL table | Entity |
| --- | --- |
| `payment_attempts` | PaymentAttempt |
| `order_items` | OrderItem |
| `orders` | Order |
| `cart_items` | CartItem |
| `carts` | Cart |
| `cart_merge_operations` | CartMergeOperation |
| `oauth_identities` | OAuthIdentity |
| `refresh_sessions` | RefreshSession |
| `email_verification_tokens` | EmailVerificationToken |
| `products` | Product |
| `users` | User |
| `categories` | Category (legacy) |
| `audit_logs` | AuditLog |

After success expect zero Products and one replacement administrator. The reset only clears records; it does not remove payment tables, schemas, provider configuration, or MoMo/VNPay runtime behavior. Uploaded files on persistent local storage are not reset by this database operation.
