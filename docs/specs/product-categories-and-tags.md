## Problem Statement

Product classes (device types) are a fixed list in code and a database CHECK constraint, so an administrator cannot add or rename one. The `/the/:tag` URL is really a brand page, and there is no real tag. No Category has more than 12 Products, so pagination never shows. Product photos differ in frame, background and style.

## Solution

Make Category an administrator-managed table, add real Tags, move brand pages to `/hang/<brand>`, grow the catalog until two Categories paginate, and normalize every Product photo to one style. Terms: see Category, Tag and Brand in `GLOSSARY.md`.

## Data model (PostgreSQL)

- `categories`: `id`, `slug` (unique among rows where `is_deleted = false`, via partial unique index), `name` (Vietnamese), `sort_order`, `is_deleted`, `created_at`, `updated_at`. Seeded with 6 rows matching the old device types; slugs unchanged: `laptop`, `keyboard`, `mouse`, `headphone`, `monitor`, `storage`.
- `products.category_id`: FK to `categories.id`, NOT NULL after backfill (`UPDATE products p SET category_id = c.id FROM categories c WHERE c.slug = p.device_type`).
- `products.device_type` stays this sprint, copied from the Category slug on every write; its column accepts 40 characters like `categories.slug`, and `products_device_type_check` is dropped. All reads use the Category. Removing the column is left to a later sprint.
- `tags`: `id`, `slug` (unique among rows where `is_deleted = false`), `name`, `is_deleted`, timestamps.
- `product_tags`: `product_id`, `tag_id`, composite primary key, both FKs.
- Brand stays a column with its CHECK constraint; it gets no table in this sprint.

## Rules

- Deleting a Category is a soft delete and is refused while any undeleted Product belongs to it.
- Changing a Category slug is refused while any Product (deleted or not) belongs to it, so URLs never break. Renaming `name` is always allowed.
- A new slug must be unique among undeleted Categories (resp. Tags); a deleted row's slug can be reused.
- Deleting a Tag is a soft delete; it disappears from Products and from `/the/*`.
- Every admin write on Categories and Tags is recorded in the audit log, like other admin screens.
- Filtering by Tag is `EXISTS` on `product_tags`; text search keeps its `unaccent` behaviour.

## URLs

- `/danh-muc/<category slug>`: Category page, paginated, 12 per page.
- `/hang/<brand>`: Brand page.
- `/the/<tag slug>`: Tag page.
- `/the/<brand>` for apple, samsung, msi, aula, logitech, razer, keychron, asus: 301 to `/hang/<brand>`. A Tag may not take one of these slugs.
- The sitemap lists `/danh-muc/*`, `/hang/*` and `/the/*` including paginated pages.
- Unknown or deleted slugs answer 404.

## Admin

A "Danh mục & thẻ" entry in the admin sidebar: list, create, rename, reorder and delete Categories and Tags, and assign Tags in the Product form. Messages are in Vietnamese; user input is rendered with `textContent`/`escapeHtml`.

## Photos

Every Product photo (main per colour and gallery): pure white `#FFFFFF`, square 1200x1200, product centred with 8-10% margin, product only (no people, scenes, desks, dark or coloured backgrounds, advertising text, promo logos or boxes), gallery = other angles of the same Product, PNG (or WebP), at most 400 KB, at least 3 photos per Product including the main one.

## Slices

1. S3-A: glossary and this spec.
2. S3-B: migration (tables, `category_id` backfill, drop CHECK), Category/Tag repositories and services, and DB contract tests (FK, partial unique slug).
3. S3-C: catalog filters, public taxonomy API, `/hang` and `/the` routes, 301 redirects, sitemap.
4. S3-D: admin "Danh mục & thẻ" screen and Product form; browser filters read Categories from the API instead of `DEVICE_TYPES`.
5. S3-E: photo normalization to the standard above.
6. S3-F: seed more Products (at least two Categories above 12) and Tags; `setval` after fixed-id inserts; demo orders keep working with the larger catalog.
