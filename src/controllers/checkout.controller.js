const checkoutService = require("../services/checkout.service");

const checkProductinStock = async (req, res) => {
    try {
        const productinStock = await checkoutService.checkProduct(req.params.id, req.body.quantity);
        res.status(200).json({ success: true, inStock: productinStock })
    }
    catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

module.exports = { checkProductinStock };

