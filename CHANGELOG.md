# Changelog

## Unreleased

- Replaced generic product categories with required Apple/Samsung/MSI brand and phone/tablet/laptop device type values across persistence, product validation, administration, and public responses; the migration retains existing product rows.
- Removed category management and category API routes, updated the normal seed compatibility path to write fixed taxonomy values, and removed the default administrator password fallback.
- Added HTTP integration coverage for supported taxonomy persistence, public product fields, invalid values, product updates, and removal of category routes.
- Added homepage product search from three characters, inclusive minimum/maximum price filters, and toggleable name/price sorting.
- Fixed the admin catalog's persistent search spinner and aligned the Google sign-in button with the login form fields.
- Reorganized normal seed data by administrator, catalog vocabulary, and commerce domain; regular seeding remains non-destructive and contains no sample Products.
- Added an explicitly confirmed, local-only one-time store reset that clears commerce/authentication records atomically, recreates admin123 with a required fresh password and first-login change, and reports per-table counts.
- Documented local seed and reset operations and their safeguards.
