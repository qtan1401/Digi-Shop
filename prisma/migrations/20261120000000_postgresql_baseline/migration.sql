CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "brand" VARCHAR(16) NOT NULL,
    "device_type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(240) NOT NULL,
    "image" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" SERIAL NOT NULL,
    "option_id" INTEGER NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "color_hex" VARCHAR(7),
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "combination_key" CHAR(64) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "cost_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL,
    "image" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "variant_id" INTEGER NOT NULL,
    "option_value_id" INTEGER NOT NULL,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variant_id","option_value_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(36) NOT NULL,
    "email" VARCHAR(320),
    "username" VARCHAR(64),
    "full_name" VARCHAR(200),
    "password_hash" VARCHAR(255),
    "role" VARCHAR(16) NOT NULL DEFAULT 'user',
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
    "email_verified_at" TIMESTAMPTZ(3),
    "failed_password_attempts" INTEGER NOT NULL DEFAULT 0,
    "password_locked_at" TIMESTAMPTZ(3),
    "force_password_change" BOOLEAN NOT NULL DEFAULT false,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "loyalty_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_addresses" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "recipient_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "address_line" VARCHAR(500) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_identities" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email_snapshot" VARCHAR(320) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "family_id" VARCHAR(36) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "replaced_by_id" VARCHAR(36),
    "remembered" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" BIGSERIAL NOT NULL,
    "cart_id" VARCHAR(36) NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_merge_operations" (
    "operation_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "result_json" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "cart_merge_operations_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(36),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "shipping_fee" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL,
    "total_price" DECIMAL(18,2) NOT NULL,
    "customer_name" VARCHAR(200) NOT NULL,
    "customer_phone" VARCHAR(32) NOT NULL,
    "customer_address" VARCHAR(500) NOT NULL,
    "customer_note" VARCHAR(1000),
    "payment_method" VARCHAR(64) NOT NULL,
    "order_status" VARCHAR(32) NOT NULL,
    "payment_status" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "points_redeemed" INTEGER NOT NULL DEFAULT 0,
    "points_discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "points_released_at" TIMESTAMPTZ(3),
    "points_credited_at" TIMESTAMPTZ(3),
    "customer_email" VARCHAR(320),
    "guest_access_token_hash" VARCHAR(64),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" BIGSERIAL NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "name_snapshot" VARCHAR(200) NOT NULL,
    "image_snapshot" VARCHAR(500) NOT NULL,
    "sku_snapshot" VARCHAR(100) NOT NULL,
    "options_snapshot" TEXT NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" VARCHAR(64) NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "provider_transaction_id" VARCHAR(100),
    "qr_payload" VARCHAR(2000),
    "payment_url" VARCHAR(2048),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "inventory_released_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" VARCHAR(80) NOT NULL,
    "actor" VARCHAR(120) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(80) NOT NULL,
    "changes_json" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "percent" INTEGER,
    "max_discount" DECIMAL(18,2),
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_listed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_vouchers" (
    "order_id" VARCHAR(64) NOT NULL,
    "voucher_id" INTEGER NOT NULL,
    "code_snapshot" VARCHAR(20) NOT NULL,
    "type_snapshot" VARCHAR(16) NOT NULL,
    "percent_snapshot" INTEGER,
    "discount_amount" DECIMAL(18,2) NOT NULL,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_vouchers_pkey" PRIMARY KEY ("order_id","voucher_id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "user_id" VARCHAR(36),
    "guest_name" VARCHAR(60),
    "rating" SMALLINT,
    "comment" VARCHAR(1000),
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" BIGSERIAL NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_is_deleted_updated_at_idx" ON "products"("is_deleted", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_product_id_position_key" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_options_product_id_is_active_position_idx" ON "product_options"("product_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_name_key" ON "product_options"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_position_key" ON "product_options"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_option_values_option_id_is_active_position_idx" ON "product_option_values"("option_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_option_id_value_key" ON "product_option_values"("option_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_option_id_position_key" ON "product_option_values"("option_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_is_active_idx" ON "product_variants"("product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_combination_key_key" ON "product_variants"("product_id", "combination_key");

-- CreateIndex
CREATE INDEX "product_variant_option_values_option_value_id_idx" ON "product_variant_option_values"("option_value_id");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses"("user_id");

-- CreateIndex
CREATE INDEX "oauth_identities_user_id_idx" ON "oauth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_identities_provider_subject_key" ON "oauth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_identities_user_id_provider_key" ON "oauth_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_revoked_at_idx" ON "refresh_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_revoked_at_idx" ON "refresh_sessions"("family_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_used_at_expires_at_idx" ON "email_verification_tokens"("user_id", "used_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- CreateIndex
CREATE INDEX "cart_merge_operations_user_id_created_at_idx" ON "cart_merge_operations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_attempts_order_id_created_at_idx" ON "payment_attempts"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_attempts_status_expires_at_idx" ON "payment_attempts"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "order_vouchers_voucher_id_idx" ON "order_vouchers"("voucher_id");

-- CreateIndex
CREATE INDEX "product_reviews_product_idx" ON "product_reviews"("product_id", "is_hidden", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "product_option_values"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_sessions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cart_merge_operations" ADD CONSTRAINT "cart_merge_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_vouchers" ADD CONSTRAINT "order_vouchers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_vouchers" ADD CONSTRAINT "order_vouchers_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraints from the final SQL Server schema (including subsequent replacements, excluding dropped checks).
ALTER TABLE "products" ADD CONSTRAINT "products_brand_check" CHECK ("brand" IN ('Apple', 'Samsung', 'MSI', 'Aula', 'Logitech', 'Razer', 'Keychron', 'Asus'));
ALTER TABLE "products" ADD CONSTRAINT "products_device_type_check" CHECK (("device_type" IN ('laptop', 'keyboard', 'mouse', 'headphone', 'monitor', 'storage') OR ("is_deleted" = true AND "device_type" IN ('phone', 'tablet'))));
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_check" CHECK ("stock" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_check" CHECK ("price" > 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_cost_price_check" CHECK ("cost_price" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'));
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('UNVERIFIED', 'ACTIVE', 'BANNED'));
ALTER TABLE "users" ADD CONSTRAINT "users_role_identity_check" CHECK (("role" = 'user' AND "email" IS NOT NULL) OR ("role" = 'admin' AND "username" IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_identity_check" CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "users_failed_password_attempts_check" CHECK ("failed_password_attempts" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_auth_version_check" CHECK ("auth_version" > 0);
ALTER TABLE "users" ADD CONSTRAINT "users_loyalty_points_check" CHECK ("loyalty_points" >= 0);
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_provider_check" CHECK ("provider" = 'google');
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "cart_merge_operations" ADD CONSTRAINT "cart_merge_operations_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_points_check" CHECK ("points_redeemed" >= 0 AND "points_discount" >= 0 AND "points_earned" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_cost_check" CHECK ("unit_cost" >= 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_check" CHECK ("provider" IN ('MOMO', 'VNPAY'));
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_status_check" CHECK ("status" IN ('PENDING', 'FAILED', 'EXPIRED', 'SUCCEEDED', 'LATE_SUCCESS'));
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_code_check" CHECK (char_length("code") BETWEEN 3 AND 20 AND "code" ~ '^[A-Z0-9]+$');
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_type_check" CHECK ("type" IN ('PERCENT', 'FREE_SHIPPING'));
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_shape_check" CHECK (("type" = 'PERCENT' AND "percent" BETWEEN 1 AND 100 AND "max_discount" BETWEEN 1000 AND 500000) OR ("type" = 'FREE_SHIPPING' AND "percent" IS NULL AND "max_discount" IS NULL));
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_period_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_quantity_check" CHECK ("quantity" >= 0 AND "redeemed_count" >= 0 AND "redeemed_count" <= "quantity");
ALTER TABLE "order_vouchers" ADD CONSTRAINT "order_vouchers_amount_check" CHECK ("discount_amount" >= 0 AND "discount_amount" <= 500000);
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_content_check" CHECK ("rating" IS NOT NULL OR ("comment" IS NOT NULL AND char_length(btrim("comment")) > 0));
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_guest_rating_check" CHECK ("rating" IS NULL OR "user_id" IS NOT NULL);
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_author_check" CHECK ("user_id" IS NOT NULL OR "guest_name" IS NOT NULL);

-- SQL Server filtered indexes: nullable identities and one default address / signed-in review.
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email") WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "users_username_unique" ON "users"(lower("username")) WHERE "username" IS NOT NULL;
CREATE UNIQUE INDEX "user_addresses_one_default_per_user" ON "user_addresses"("user_id") WHERE "is_default" = true;
CREATE UNIQUE INDEX "product_reviews_product_user_key" ON "product_reviews"("product_id", "user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX "payment_attempts_provider_transaction_id_idx" ON "payment_attempts"("provider_transaction_id") WHERE "provider_transaction_id" IS NOT NULL;

-- unaccent is STABLE; the fixed-dictionary wrapper permits a persistent expression index.
CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
CREATE INDEX "products_name_unaccent_idx" ON "products" (lower(public.immutable_unaccent("name")));
