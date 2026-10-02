# Changelog

## Unreleased

- Replaced generic product categories with required Apple/Samsung/MSI brand and phone/tablet/laptop device type values across persistence, product validation, administration, and public responses; the migration retains existing product rows.
- Removed category management and category API routes, updated the normal seed compatibility path to write fixed taxonomy values, and removed the default administrator password fallback.
- Added HTTP integration coverage for supported taxonomy persistence, public product fields, invalid values, product updates, and removal of category routes.
- Added homepage product search from three characters, inclusive minimum/maximum price filters, and toggleable name/price sorting.
- Added an accessible hamburger filter popover with multi-select Brand and Device type filters that compose with search and inclusive price bounds; catalog cards now show taxonomy metadata and the empty state remains clear.
- Set the storefront Product catalog to a four-column desktop grid (12 Products across three rows), responsive 3/2/1-column breakpoints, and consistent 4:3 image frames using `object-fit: contain`.
- Linked each catalog card's image and product information to its detail page using Product ID; purchase and add-to-cart controls remain separate. Added HTTP coverage for the public Product detail API.
- Fixed the admin catalog's persistent search spinner and aligned the Google sign-in button with the login form fields.
- Reorganized normal seed data by administrator, catalog vocabulary, and commerce domain; regular seeding remains non-destructive and contains no sample Products.
- Added an explicitly confirmed, local-only one-time store reset that clears commerce/authentication records atomically, recreates admin123 with a required fresh password and first-login change, and reports per-table counts.
- Extended the explicit local reset to clear legacy category rows retained by the non-destructive Product migration; rollback verification covers their deletion and restoration.
- Documented local seed and reset operations and their safeguards.

- Replaced the product image URL field with authenticated, CSRF-protected PNG or WebP uploads validated by detected content, extension, media type, and a 5 MiB server-side limit; static images are stored with their correct `.png` or `.webp` extension on configurable local storage.
- Added full PNG signature/chunk/CRC validation and full WebP decoding; uploads remain capped at 5 MiB, 8,192 px per side, and 25 MP, with distinct corruption and resolution errors.
- Added HTTP coverage for uppercase `.PNG`, actual WebP content named `.png`, malformed images, byte and resolution boundaries, unauthorized requests, and image replacement/retention; documented durable storage and supported formats.
- Added a confirmed local rollback-check command that executes the reset clear inside a transaction, always rolls back, and verifies all affected table counts are unchanged.
