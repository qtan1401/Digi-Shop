# Changelog

## Unreleased

- Replaced generic product categories with required Apple/Samsung/MSI brand and phone/tablet/laptop device type values across persistence, product validation, administration, and public responses; the migration retains existing product rows.
- Removed category management and category API routes, updated the normal seed compatibility path to write fixed taxonomy values, and removed the default administrator password fallback.
- Added HTTP integration coverage for supported taxonomy persistence, public product fields, invalid values, product updates, and removal of category routes.
- Added homepage product search from three characters, inclusive minimum/maximum price filters, and toggleable name/price sorting.
- Fixed the admin catalog's persistent search spinner and aligned the Google sign-in button with the login form fields.

- Replaced the product image URL field with authenticated, CSRF-protected single-PNG uploads validated by extension, MIME type, signature, and a 5 MiB server-side limit; images are stored on configurable local storage and edit forms retain the current image unless replaced.
- Added HTTP coverage for valid, malformed, oversized, unauthorized, CSRF-failing, replacement, and image-retention upload behavior, plus durable-volume and environment configuration guidance.
