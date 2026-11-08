// ===== VAT.JS =====
// Catalogue prices already include 10% VAT, so totals never change; this only works out the amount to show
// ("Đã bao gồm VAT 10%"). The one frontend home of the formula, same as src/services/vat.js on the server.
(function () {
    "use strict";
    const VAT_PERCENT = 10;
    // round(subtotal * 10 / 110)
    const includedVat = (subtotal) => Math.round((Number(subtotal) || 0) * VAT_PERCENT / (100 + VAT_PERCENT));
    window.DigiVat = Object.freeze({ VAT_PERCENT, includedVat, label: `Đã bao gồm VAT ${VAT_PERCENT}%` });
})();
