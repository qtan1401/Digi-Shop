-- Sprint 3: administrator-managed categories and real tags.
-- Order matters: create categories, backfill products.category_id from products.device_type, only then enforce
-- NOT NULL + FK and drop the fixed device_type CHECK. SET NOT NULL fails loudly if any product stayed unmapped,
-- which rolls the whole migration back, so no product row is ever lost or left half-migrated.

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9-]{2,40}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_active_key" ON "categories"("slug") WHERE "is_deleted" = false;

-- CreateIndex
CREATE INDEX "categories_is_deleted_sort_order_idx" ON "categories"("is_deleted", "sort_order");

-- Six live categories (slug and Vietnamese name = old DEVICE_TYPE_LABELS) plus two hidden ones so the soft-deleted
-- phone/tablet products can be backfilled. The hidden rows are never listed anywhere.
INSERT INTO "categories" ("slug", "name", "sort_order", "is_deleted", "deleted_at") VALUES
    ('laptop', 'Laptop', 1, false, NULL),
    ('keyboard', 'Bàn phím', 2, false, NULL),
    ('mouse', 'Chuột', 3, false, NULL),
    ('headphone', 'Tai nghe máy tính', 4, false, NULL),
    ('monitor', 'Màn hình', 5, false, NULL),
    ('storage', 'Ổ cứng SSD', 6, false, NULL),
    ('phone', 'Điện thoại', 7, true, CURRENT_TIMESTAMP),
    ('tablet', 'Máy tính bảng', 8, true, CURRENT_TIMESTAMP);

-- AlterTable: nullable first, backfill, then enforce.
ALTER TABLE "products" ADD COLUMN "category_id" INTEGER;

UPDATE "products" p SET "category_id" = c."id" FROM "categories" c WHERE c."slug" = p."device_type";

ALTER TABLE "products" ALTER COLUMN "category_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "products_category_id_is_deleted_idx" ON "products"("category_id", "is_deleted");

-- The category list is no longer fixed in the database. products.device_type stays (copied from the category slug).
ALTER TABLE "products" DROP CONSTRAINT "products_device_type_check";

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tags_slug_format_check" CHECK ("slug" ~ '^[a-z0-9-]{2,40}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_active_key" ON "tags"("slug") WHERE "is_deleted" = false;

-- CreateTable
CREATE TABLE "product_tags" (
    "product_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id", "tag_id")
);

-- CreateIndex
CREATE INDEX "product_tags_tag_id_idx" ON "product_tags"("tag_id");

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
