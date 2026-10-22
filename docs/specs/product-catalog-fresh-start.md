## Problem Statement

Digi-Shop products are currently organized by a generic category and name. Customers cannot narrow the catalog by brand or device type, and administrators must provide an image URL instead of uploading a product image. The current catalog, orders, account data, and audit history also need to be removed so the shop can start with a clean data set.

## Solution

Replace the generic category dimension with a fixed catalog vocabulary: brands Apple, Samsung, and MSI; device types phone, tablet, and laptop. Add multi-select brand and device filters in a hamburger-triggered popover while preserving the current price controls, search, and sorting. Show each product's brand and device type beneath its name, remove the “Sản phẩm” navbar link, and display Products in a four-column desktop grid for the 15 seeded examples (four rows, with three cards in the last row). Collapse the grid to three, two, then one column at narrower viewport widths. Keep product images fully visible in a consistent 4:3 frame, and link the image and product information to the detail page by Product ID while keeping purchase/cart actions separate. On Product detail pages, omit internal ID and slug metadata and show colon-labelled description entries in a responsive two-column specifications table, with plain text retained as one “Mô tả” row.

Allow administrators to upload one validated PNG or WebP image for each color value on products with a `Màu sắc` option; products without a color option keep one cover image. Enforce 5 MiB, 8,192 px per edge, and 25 MP decoded-resolution limits. Identify format from file content, fully decode WebP before storage, preserve the detected `.png` or `.webp` extension, and reject animated WebP. Store images on the persistent local filesystem. Add optional `#RRGGBB` swatch metadata to each color value and persist a per-variant image so every storage variant of a color uses that color's photo. Regular seeding remains idempotent and non-destructive, and supplies five sample products per device type; the separate one-time reset continues to clear the catalog and create the replacement administrator.

## User Stories

1. As a customer, I want to see a product's brand, so that I can identify its maker before opening its details.
2. As a customer, I want to see a product's device type, so that I can distinguish phones, tablets, and laptops.
3. As a customer, I want to filter by Apple, Samsung, or MSI, so that I can browse products from a preferred brand.
4. As a customer, I want to filter by phone, tablet, or laptop, so that I can browse only the devices I need.
5. As a customer, I want to select multiple brands, so that the catalog includes products from any selected brand.
6. As a customer, I want to select multiple device types, so that I can compare more than one kind of device at a time.
7. As a customer, I want brand and device filters to combine, so that a selected device type is narrowed to the selected brands.
8. As a customer, I want the brand and device filters to work with price and text search, so that every active criterion narrows the same result set.
9. As a customer, I want the existing minimum and maximum price controls to remain available, so that the new catalog filters do not remove price-based browsing.
10. As a customer, I want the current product search and sorting controls to continue working, so that the catalog redesign preserves existing browsing behavior.
11. As a customer, I want to open the brand and device filters from a hamburger button, so that filter choices do not permanently occupy catalog space.
12. As a customer, I want the filter popover to close after I dismiss it, so that it does not obstruct the catalog while I browse.
13. As a keyboard user, I want to open and dismiss the filter popover using accessible controls, so that I can use the catalog without a pointer.
14. As a customer, I want an empty-result message when no products match my filters, so that I understand why the catalog has no cards.
15. As a customer, I want the product card to show brand and device type beneath the product name, so that I can scan the catalog quickly.
16. As a customer, I want to retain the product's stock indicator, so that I can tell whether it is available.
17. As a customer, I want the “Sản phẩm” navbar link removed while the home catalog remains available, so that the navigation matches the requested layout.
18. As an administrator, I want to choose one of the supported brands when creating a product, so that each product has a consistent brand value.
19. As an administrator, I want to choose one of the supported device types when creating a product, so that every product is organized consistently.
20. As an administrator, I want to update a product's brand and device type, so that its catalog classification stays accurate.
21. As an administrator, I want to upload a PNG or WebP file instead of entering an image URL, so that I can manage product images from the catalog form.
22. As an administrator, I want unsupported or malformed image files rejected, so that only valid PNG and WebP images enter the catalog.
23. As an administrator, I want uploads larger than 5 MiB or beyond the decoded resolution limits rejected with a clear field error, so that I can correct the image without guessing why it failed.
24. As an administrator, I want an existing product image retained when I edit other fields without selecting a replacement, so that an unrelated edit does not remove its image.
25. As an administrator, I want an uploaded image to remain available after the application restarts or redeploys, so that products do not lose images when the host restarts.
26. As a store operator, I want image uploads restricted to an authenticated administrator request, so that customers cannot write files to the catalog.
27. As a store operator, I want the one-time reset to remove all existing products and device/category records, so that the new catalog starts without legacy items.
28. As a store operator, I want the one-time reset to remove all Orders, OrderItems, and Payment attempts, so that no previous purchase or payment history remains.
29. As a store operator, I want the one-time reset to remove all user accounts and their authentication records, so that the new shop has no legacy customer or administrator accounts.
30. As a store operator, I want the one-time reset to remove cart contents and cart-merge records, so that no abandoned basket refers to deleted products or users.
31. As a store operator, I want the one-time reset to clear audit history, so that the new administrator dashboard has no records from the previous shop.
32. As a store operator, I want the reset to complete atomically, so that a failure does not leave a partially erased database.
33. As a store operator, I want the reset to create a new `admin123` account with a temporary local bootstrap password, so that I can access the clean administration area.
34. As a new administrator, I want to be required to change the bootstrap password at first login, so that the temporary credential is not used long term.
35. As a store operator, I want the ordinary seed to supply five representative Products for each supported device type, so that the public catalog is populated with example phones, tablets, and laptops.
36. As a store operator, I want normal seed runs to be repeatable without deleting database records, so that deploying or reseeding cannot unexpectedly erase products added later.
37. As a store operator, I want the MoMo and VNPay integrations to remain available for future Orders, so that resetting old records does not remove payment functionality.
38. As a customer, I want to choose a product color and see that color's photo and swatch selected, so that the detail page reflects the finish I am viewing.
39. As a customer, I want to choose a storage value and see the matching variant's price, SKU, and availability, so that I can buy the correct configuration.

## Implementation Decisions

- Model each Product with a required Brand and Device type. The supported values are fixed to Apple, Samsung, and MSI for Brand; and phone, tablet, and laptop for Device type. Server-side validation enforces these allowlists.
- Keep Product metadata shared across its variants. An option (such as `Màu sắc` or `Bộ nhớ`) has named values; color values may include an `#RRGGBB` swatch color. Each Product variant is a purchasable combination with its own unique SKU, price, stock, and optional image; all variants with the same color use that color's image. Cart items and new OrderItems identify the selected variant.
- Migrate existing catalog rows without deleting Products: create one active default Product variant per existing Product, carrying its former SKU, price, and stock. Relink existing carts and OrderItems; preserve historical OrderItem name, image, price, quantity, and total snapshots, and copy SKU plus empty options into new snapshot fields.
- Replace the generic product-category dimension and its administrator-managed category choices with the fixed Device type choice. The old “Phụ kiện” category is not part of the new catalog. Do not introduce a second generic category dimension.
- Include Brand and Device type in public product responses. Apply their filters in the existing client-side catalog pipeline, alongside the existing search, minimum/maximum price filters, and sorting.
- Implement the hamburger control as a popover containing multi-select Brand and Device type choices. Multiple values within one facet use OR; separate facets, price, and search combine with AND. Keep the current price controls in their existing location and preserve their behavior.
- Remove the “Sản phẩm” link from the navbar. Keep the catalog on the home page, show Brand and Device type as compact metadata beneath each product name, and retain the stock badge.
- Replace URL entry in the administrator product form with structured option/value controls and image uploads. For a Product with `Màu sắc`, require one PNG or WebP image for every color; keep one cover-image upload for products without a color option. Accept PNG and WebP, enforce a 5 MiB file-size limit, an 8,192 px maximum edge, and a 25 MP decoded-pixel limit. Detect actual format from file content so valid WebP bytes are accepted even when the filename ends in `.png`; validate PNG signature, complete chunk structure, and CRC, and fully decode WebP. Reject animated WebP. A browser `accept` attribute is only a convenience, not a security check; return distinct field errors for corrupt content, excessive dimensions, byte size, or a missing color photo.
- Store uploaded image bytes on a configurable persistent local filesystem directory and persist only a stable public image path in the Product record. The deployment must mount durable storage at that directory. Do not add a cloud object-storage dependency in this scope.
- Keep existing administrator authentication and CSRF requirements for product mutations. Reject unauthorized uploads and invalid images without persisting files; return field-level errors through the existing form contract. When editing, preserve existing per-color images unless that color's photo is replaced; unrelated edits keep all images unchanged.
- Add a separate, explicitly invoked one-time reset operation. It is not part of application startup, the regular seed command, or an automatic deployment migration. It targets the current local SQL Server database (`localhost:1433`, database `DigiShop`) and requires a clear operator confirmation.
- The reset removes Products, Product options, Product option values, Product variants and variant links, legacy category data, Orders, OrderItems, Payment attempts, Carts and cart contents, cart-merge records, Users and their OAuth/session/verification records, and Audit logs. Delete records in foreign-key-safe order and in one transaction; in particular, clear Payment attempts before Orders, cart references before Products, and variant links/variants/options before their parents. Recreate the new administrator only after the destructive data removal succeeds.
- Use `admin123` as the bootstrap administrator username. Supply a newly generated local bootstrap password through environment configuration for the one-time reset; do not commit it or reuse a previously disclosed credential. Mark it for mandatory change at first login. Public deployments must supply a strong secret through deployment configuration.
- Reorganize seed inputs by domain/entity. Keep ordinary seeding idempotent and non-destructive, seed the fixed catalog vocabulary, the configured administrator bootstrap, and five example Products per supported device type, with named color/storage values and image-backed variants. OrderItem seed entries identify a variant by SKU and persist its SKU/options snapshots. Running the regular seed command must not act as a database reset.
- Keep order/payment lifecycle, MoMo, and VNPay behavior unchanged. Cart availability, checkout stock deduction, and payment reservation/release operate on the selected Product variant's stock. The catalog migration preserves every existing Product and carries its SKU, price, and stock into its default variant.

## Testing Decisions

- Good tests assert externally visible behavior through the highest practical public seam. They describe customer or administrator outcomes, not private helpers, internal call counts, copied payloads, or incidental markup.
- Test product create/update, public listing, and Product detail lookup through HTTP requests to the real Express application. Use the existing in-memory Prisma test boundary and a temporary upload directory; assert persisted product behavior, allowlist validation, PNG and WebP validation, size boundaries, image replacement/retention, and authorization/CSRF failures.
- Exercise the storefront in a real browser: verify filters, search, sorting, empty results, a four-column layout containing all 15 seeded Products, responsive 3/2/1-column breakpoints, image framing, card navigation to matching Product details, color selection changing the main image, structured color/storage choices, absence of ID/slug metadata, and structured/plain-text description rendering.
- Exercise the administrator upload surface in a real browser with PNG and WebP files, including WebP bytes named `.png`, malformed/corrupt images, a file over 5 MiB, images beyond each resolution limit, missing color photos, per-color image replacement, and retention of unchanged color images. Verify visible errors and that invalid uploads never create records or files.
- Verify the one-time reset against the explicitly targeted local SQL Server database: report row counts before and after for every cleared table, confirm the sole replacement administrator and empty Product catalog, and confirm that a failed transaction does not leave partial deletion. Do not run this verification against production.
- Run the existing `npm test` suite to protect payment and application behavior. Prior art is the HTTP integration suite that starts the Express application on a loopback port and substitutes an in-memory Prisma client at the database boundary.
- The user approved this seam: HTTP integration tests with in-memory persistence and temporary file storage, plus browser smoke checks for the user-facing catalog and upload flow.

## Out of Scope

- Additional Brands or Device types, and administrator-managed taxonomy editing.
- Keeping a separate generic category dimension or retaining the old “Phụ kiện” category.
- Other image formats, animated WebP, additional gallery images beyond one image per color, image resizing, thumbnails, or an image CDN.
- Cloud/object storage or cross-region/distributed file replication.
- Production inventory curation beyond the 15 representative seed Products.
- A destructive reset during normal seed runs, app startup, or every deployment.
- Archiving or restoring the deleted Users, Orders, Products, Payment attempts, or Audit logs.
- Changing checkout, inventory, order, or payment-provider behavior beyond clearing existing records during the one-time reset.

## Further Notes

- The configured local database is `DigiShop` on `localhost:1433`. The reset is destructive and is intended to run once against this local target; no reset has been run as part of writing this specification.
- Generate a fresh local bootstrap password at reset time and change it at first administrator login; production credentials remain deployment secrets.
- Local filesystem image storage is durable only if the deployment host provides a persistent volume. A host with ephemeral storage would lose uploaded files during redeploy and is not compatible with this decision without a later storage change.
- Existing `OrderItem` records snapshot product name, image, and price, but this reset deletes those Orders and snapshots by explicit user choice. No nullable Product reference or order-history-preservation migration is required for this reset.
