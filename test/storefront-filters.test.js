import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/js/main.js", import.meta.url), "utf8");
const context = vm.createContext({
    document: { addEventListener() {} },
    window: { clearTimeout() {}, setTimeout() {} },
    Intl, Set, Number, String, Array, Math
});
vm.runInContext(source, context);

test("catalog filters compose OR within each facet and AND across facets, search, and inclusive prices", () => {
    const products = [
        { name: "Apple phone", description: "Pro", brand: "Apple", deviceType: "phone", price: 100 },
        { name: "Samsung phone", description: "Pro", brand: "Samsung", deviceType: "phone", price: 200 },
        { name: "Samsung tablet", description: "Pro", brand: "Samsung", deviceType: "tablet", price: 150 },
        { name: "MSI laptop", description: "Pro", brand: "MSI", deviceType: "laptop", price: 200 },
        { name: "Apple tablet", description: "Basic", brand: "Apple", deviceType: "tablet", price: 150 }
    ];
    Object.assign(context.catalogState, {
        products, brands: new Set(["Apple", "Samsung"]), deviceTypes: new Set(["phone", "tablet"]),
        appliedSearch: "pro", minPrice: "100", maxPrice: "200"
    });
    assert.deepEqual(Array.from(context.getFilteredProducts(), (product) => product.name), ["Apple phone", "Samsung phone", "Samsung tablet"]);

    context.catalogState.brands = new Set(["MSI"]);
    assert.deepEqual(Array.from(context.getFilteredProducts()), []);
    context.catalogState.brands.clear();
    context.catalogState.deviceTypes.clear();
    context.catalogState.appliedSearch = "";
    assert.deepEqual(Array.from(context.getFilteredProducts(), (product) => product.name), products.map((product) => product.name));
});

test("catalog cards show brand and device type and retain the stock indicator", () => {
    const product = { id: 1, name: "Galaxy", description: "", brand: "Samsung", deviceType: "phone", image: "/phone.png", price: 100, stock: 3 };
    const card = context.createProductCard(product, false);
    assert.match(card, /Samsung · phone/);
    assert.match(card, /Còn 3/);
});
