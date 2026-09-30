# Changelog

## Unreleased

- Replaced generic product categories with required Apple/Samsung/MSI brand and phone/tablet/laptop device type values across persistence, product validation, administration, and public responses; the migration retains existing product rows.
- Removed category management and category API routes, updated the normal seed compatibility path to write fixed taxonomy values, and removed the default administrator password fallback.
- Added HTTP integration coverage for supported taxonomy persistence, public product fields, invalid values, product updates, and removal of category routes.
- Added homepage product search from three characters, inclusive minimum/maximum price filters, and toggleable name/price sorting.
- Added an accessible hamburger filter popover with multi-select Brand and Device type filters that compose with search and inclusive price bounds; catalog cards now show taxonomy metadata and the empty state remains clear.
- Fixed the admin catalog's persistent search spinner and aligned the Google sign-in button with the login form fields.
