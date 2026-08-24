const productRepository = require("../repositories/product.repository");

const checkProduct = async (id, quantity) => {
    const product = await productRepository.findById(id);
    if (!product) {
        throw new Error("Product not found");
    }
    if (product.stock < quantity) {
        throw new Error("Product is out of stock");
    }
    else {
        return product;
    }
}

module.exports = {
    checkProduct
}