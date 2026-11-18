# PostgreSQL baseline migration

The active Prisma migration history starts at `20261120000000_postgresql_baseline`. It creates the final, empty PostgreSQL schema; it does **not** copy existing SQL Server data. All 15 original SQL Server migrations remain unchanged in `prisma/migrations-sqlserver/`. The SQL baseline was generated with Prisma 7.10.0 `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, then augmented with the constraints, partial indexes and search function that Prisma does not model.

## Type and naming mapping

| SQL Server / Prisma before | PostgreSQL / Prisma now |
| --- | --- |
| `NVARCHAR(n)` / `@db.NVarChar(n)` | `VARCHAR(n)` / `@db.VarChar(n)` (Unicode remains supported) |
| `NVARCHAR(MAX)` / `@db.NVarChar(Max)` | `TEXT` / `@db.Text` |
| `DATETIME2` / `@db.DateTime2` | `TIMESTAMPTZ(3)` / `@db.Timestamptz(3)` |
| `SYSUTCDATETIME()` | `now()` (timezone-aware instant, sent to Prisma as a Date) |
| `DECIMAL(p,s)` / `@db.Decimal(p,s)` | `DECIMAL(p,s)` / `@db.Decimal(p,s)` |
| `CHAR(n)` / `@db.Char(n)` | `CHAR(n)` / `@db.Char(n)` |
| `TINYINT` / `@db.TinyInt` | `SMALLINT` / `@db.SmallInt` |
| `BIT` | `BOOLEAN`; `= 1` becomes `= true` |
| UUID stored as `NVARCHAR(36)` | `VARCHAR(36)`, **not** PostgreSQL `UUID`; application string IDs stay unchanged |

The schema retains all Prisma `@map`, `@@map` and explicit `map:` names. Legacy named CHECK constraints and partial indexes below keep exactly the same name.

## CHECK constraints

The final SQL Server schema has **31 active named CHECK constraints** (not 34 as initially estimated). Across the 15 archived migrations there are 33 distinct CHECK names; `products_stock_check` and `products_price_check` are dropped in `20261002000000_product_variants` and must **not** be recreated. Later migrations replace `users_status_check`, `products_brand_check` and `products_device_type_check` with the final versions. This table records every active original name → PostgreSQL name (unchanged):

| Table | Original CHECK | PostgreSQL CHECK |
| --- | --- | --- |
| `products` | `products_brand_check` | `products_brand_check` |
| `products` | `products_device_type_check` | `products_device_type_check` |
| `product_variants` | `product_variants_stock_check` | `product_variants_stock_check` |
| `product_variants` | `product_variants_price_check` | `product_variants_price_check` |
| `product_variants` | `product_variants_cost_price_check` | `product_variants_cost_price_check` |
| `users` | `users_role_check` | `users_role_check` |
| `users` | `users_status_check` | `users_status_check` |
| `users` | `users_role_identity_check` | `users_role_identity_check` |
| `users` | `users_identity_check` | `users_identity_check` |
| `users` | `users_failed_password_attempts_check` | `users_failed_password_attempts_check` |
| `users` | `users_auth_version_check` | `users_auth_version_check` |
| `users` | `users_loyalty_points_check` | `users_loyalty_points_check` |
| `oauth_identities` | `oauth_identities_provider_check` | `oauth_identities_provider_check` |
| `cart_items` | `cart_items_quantity_check` | `cart_items_quantity_check` |
| `cart_merge_operations` | `cart_merge_operations_status_check` | `cart_merge_operations_status_check` |
| `orders` | `orders_points_check` | `orders_points_check` |
| `order_items` | `order_items_quantity_check` | `order_items_quantity_check` |
| `order_items` | `order_items_unit_cost_check` | `order_items_unit_cost_check` |
| `payment_attempts` | `payment_attempts_amount_check` | `payment_attempts_amount_check` |
| `payment_attempts` | `payment_attempts_provider_check` | `payment_attempts_provider_check` |
| `payment_attempts` | `payment_attempts_status_check` | `payment_attempts_status_check` |
| `vouchers` | `vouchers_code_check` | `vouchers_code_check` |
| `vouchers` | `vouchers_type_check` | `vouchers_type_check` |
| `vouchers` | `vouchers_shape_check` | `vouchers_shape_check` |
| `vouchers` | `vouchers_period_check` | `vouchers_period_check` |
| `vouchers` | `vouchers_quantity_check` | `vouchers_quantity_check` |
| `order_vouchers` | `order_vouchers_amount_check` | `order_vouchers_amount_check` |
| `product_reviews` | `product_reviews_rating_check` | `product_reviews_rating_check` |
| `product_reviews` | `product_reviews_content_check` | `product_reviews_content_check` |
| `product_reviews` | `product_reviews_guest_rating_check` | `product_reviews_guest_rating_check` |
| `product_reviews` | `product_reviews_author_check` | `product_reviews_author_check` |

The voucher code CHECK uses `char_length(code)` and `code ~ '^[A-Z0-9]+$'`; the review content CHECK uses `char_length(btrim(comment))`. Retired phone/tablet Products are permitted only where `is_deleted = true`. The baseline creates no retired Products.

## Filtered indexes

| SQL Server index | PostgreSQL index (same name) | Predicate |
| --- | --- | --- |
| `users_email_unique` | `users_email_unique` | `email IS NOT NULL` (unique) |
| `users_username_unique` | `users_username_unique` | `username IS NOT NULL` (unique on `lower(username)`) |
| `user_addresses_one_default_per_user` | `user_addresses_one_default_per_user` | `is_default = true` (unique) |
| `product_reviews_product_user_key` | `product_reviews_product_user_key` | `user_id IS NOT NULL` (unique) |
| `payment_attempts_provider_transaction_id_idx` | `payment_attempts_provider_transaction_id_idx` | `provider_transaction_id IS NOT NULL` (**nonunique**) |

The primary keys, ordinary and unfiltered unique indexes are generated from the Prisma schema. A nullable PostgreSQL unique index permits multiple NULLs, but the explicit predicates preserve the SQL Server definitions and names. The username index uses `lower(username)` because usernames retain their entered case while login normalizes identifiers; a second spelling differing only by case must be rejected.

## Collation and search

PostgreSQL comparisons are case-sensitive by default, unlike the old SQL Server database. Product search uses `lower(immutable_unaccent(column)) LIKE` with escaped wildcards to retain literal substring matching without case or accents; voucher search uses `ILIKE`. The migration installs `unaccent` and defines `public.immutable_unaccent(text)` (an IMMUTABLE wrapper calling `public.unaccent('public.unaccent', $1)`) plus `products_name_unaccent_idx` on `lower(public.immutable_unaccent(name))`. The required B-tree expression index does not accelerate the current leading-wildcard (`%term%`) search; it can serve prefix queries. Vietnamese name ordering explicitly uses ICU `COLLATE "vi-VN-x-icu"` if that collation is available on the target PostgreSQL host (inspect `pg_collation` there).

## Applying and checking

Run `prisma validate` with a PostgreSQL-format `DATABASE_URL` and apply the active migrations only to a separate, disposable `digishop_test` PostgreSQL database. A reset destroys data in its target database: never point it at SQL Server `DigiShop` or a production database. After a reset, compare the database and `prisma/schema.prisma` with `prisma migrate diff` (Prisma does not model manually authored CHECK constraints or expression/partial indexes). Independently inspect these additions:

```sql
SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname;
-- 31 active named checks, as listed above.
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '% WHERE %' ORDER BY indexname;
-- Five partial indexes, four unique and one nonunique.
```

For a deliberate local reseed after migrating `digishop`, set `STORE_RESET_CONFIRMATION=RESET LOCAL DIGISHOP` in the command environment and provide a fresh `ADMIN_DEFAULT_PASSWORD` (at least 16 characters), then run `npm run db:reset:local`. This operation deletes the shop's PostgreSQL data and seeds it again; never run it against `digishop_test` or a production URL. `npm run test:db` uses only `TEST_DATABASE_URL` and refuses database names without the `_test` suffix.

## Returning to SQL Server

Keep the existing SQL Server `DigiShop` database untouched. To return, restore the previous SQL Server Prisma schema, Prisma configuration, SQL Server adapter and repository SQL from the SQL Server revision; restore `prisma/migrations-sqlserver/` to the active `prisma/migrations/` path (including its original lock). Point the SQL Server deployment at its existing database; **do not** run the PostgreSQL baseline against SQL Server or use `migrate reset` on the existing SQL Server database. Data added to PostgreSQL is not copied back automatically and requires a separately planned export/import.
