// ===== VAT =====
// Catalogue prices already include 10% VAT, so totals never change; the amount is only shown to the customer
// (cart summary, checkout, order detail, confirmation email). The frontend has the same formula in public/js/vat.js.

const VAT_PERCENT = 10;

/** The VAT contained in a VAT-inclusive subtotal: round(subtotal * 10 / 110). */
const includedVat = (subtotal) => Math.round((Number(subtotal) || 0) * VAT_PERCENT / (100 + VAT_PERCENT));

module.exports = { VAT_PERCENT, includedVat };
