const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const seedData = require("../prisma/seed-data");
const { COMMENT_POOL_SIZE, buildSeedFixtures } = require("../prisma/seed-fixtures");
const { normalizeSeedData, SeedDataError } = require("../scripts/db/normalize-seed");
const {
    backfillProductImages, backfillSeedExtras, classifyOrders, classifyReviews, classifyUsers, classifyVouchers, createSummary, resolveSeedOrderItems
} = require("../prisma/seed");

const { products, users, vouchers, orders, reviews } = seedData.commerce;
const SHIPPING_FEE = 100000;
const DAY = 24 * 60 * 60 * 1000;
const skuToProduct = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.sku, product.id])));
const orderProducts = (order) => new Set(order.items.map((item) => skuToProduct.get(item.variantSku)));
const delivered = orders.filter((order) => order.orderStatus === "DELIVERED");
const vnd = (text) => Number(text.replace(/\.00$/, ""));

test("seed fixtures are deterministic for a given reference time and only timestamps move with it", () => {
    const reference = new Date("2026-11-05T10:00:00Z");
    const first = buildSeedFixtures(products, reference);
    assert.deepEqual(buildSeedFixtures(products, reference), first);
    const later = buildSeedFixtures(products, new Date(reference.getTime() + 30 * DAY));
    const stable = (fixtures) => JSON.stringify(fixtures, (key, value) => (/(At|^at)$/.test(key) ? undefined : value));
    assert.equal(stable(later), stable(first));
    assert.notDeepEqual(later.orders.map((order) => order.createdAt), first.orders.map((order) => order.createdAt));
});

test("seed customers are active, verified, password-less @seed.local accounts", () => {
    assert.equal(users.length, 12);
    for (const user of users) {
        assert.equal(user.role, "user");
        assert.equal(user.status, "ACTIVE");
        assert.match(user.email, /^[a-z.]+@seed\.local$/);
        assert.match(user.username, /^[a-z0-9._]+$/);
        assert.ok(user.emailVerifiedAt);
        assert.equal("passwordHash" in user, false);
    }
    assert.equal(new Set(users.map((user) => user.username)).size, users.length);
    assert.equal(new Set(users.map((user) => user.id)).size, users.length);
});

test("every order has consistent totals, a stable id, and the fixed shipping fee", () => {
    assert.equal(delivered.length, 40);
    assert.equal(orders.length - delivered.length, 8);
    assert.equal(new Set(orders.map((order) => order.id)).size, orders.length);
    for (const order of orders) {
        assert.match(order.id, /^ORD-[0-9A-Z]+-[0-9A-Z]{5}$/);
        const subtotal = order.items.reduce((sum, item) => sum + vnd(item.lineTotal), 0);
        for (const item of order.items) assert.equal(vnd(item.unitPrice) * item.quantity, vnd(item.lineTotal));
        assert.equal(vnd(order.subtotal), subtotal);
        assert.equal(vnd(order.shippingFee), SHIPPING_FEE);
        assert.equal(vnd(order.totalPrice), vnd(order.subtotal) + SHIPPING_FEE - vnd(order.discount));
        assert.ok(vnd(order.totalPrice) >= 1000);
        assert.ok(["COD", "MOMO", "VNPAY"].some((method) => order.paymentMethod === method || order.paymentMethod === "Thanh toán khi nhận hàng (COD)"));
        assert.ok(users.some((user) => user.id === order.userId));
    }
});

test("delivered orders are 7-90 days old and recent orders cover every other state", () => {
    const reference = Math.max(...orders.map((order) => Date.parse(order.updatedAt)));
    const now = Date.now();
    assert.ok(reference <= now + 1000);
    for (const order of delivered) {
        const ageDays = (now - Date.parse(order.createdAt)) / DAY;
        assert.equal(order.paymentStatus, "PAID");
        assert.ok(ageDays >= 7 && ageDays <= 90.1, `${order.id} is ${ageDays} days old`);
    }
    const recent = orders.filter((order) => order.orderStatus !== "DELIVERED");
    for (const order of recent) assert.ok(now - Date.parse(order.createdAt) <= 48 * 60 * 60 * 1000 + 5000);
    assert.deepEqual([...new Set(recent.map((order) => order.orderStatus))].sort(), ["CANCELLED", "PENDING", "PROCESSING", "SHIPPED"]);
    const stale = (order) => now - Date.parse(order.createdAt) > 24 * 60 * 60 * 1000;
    assert.ok(recent.some((order) => order.orderStatus === "PENDING" && order.paymentStatus === "UNPAID" && order.paymentMethod.includes("COD") && stale(order)));
    assert.ok(recent.some((order) => order.orderStatus === "PENDING" && order.paymentStatus === "PAID" && ["MOMO", "VNPAY"].includes(order.paymentMethod) && stale(order)));
    assert.ok(recent.some((order) => order.orderStatus === "CANCELLED" && order.paymentStatus === "REFUNDED"));
});

test("vouchers cover every state and each redeemed_count equals its unreleased order vouchers", () => {
    const now = Date.now();
    const byCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    for (const voucher of vouchers) {
        const used = orders.flatMap((order) => order.vouchers).filter((entry) => entry.code === voucher.code && entry.releasedAt === null);
        assert.equal(voucher.redeemedCount, used.length, voucher.code);
        assert.ok(voucher.redeemedCount <= voucher.quantity);
        assert.ok(voucher.description.length <= 200);
        assert.match(voucher.code, /^[A-Z0-9]{5}$/, "codes are 5 alphanumeric characters");
        assert.ok(voucher.quantity >= 1 && voucher.quantity <= 10, `${voucher.code} usage limit is at most 10`);
        assert.equal(new Date(voucher.endsAt).getUTCFullYear(), 9999, `${voucher.code} never expires`);
        if (voucher.type === "PERCENT") {
            assert.ok(voucher.percent >= 1 && voucher.percent <= 100);
            assert.ok(vnd(voucher.maxDiscount) >= 1000 && vnd(voucher.maxDiscount) <= 500000);
        } else {
            assert.equal(voucher.percent, null);
            assert.equal(voucher.maxDiscount, null);
        }
    }
    const active = (voucher) => voucher.isEnabled && Date.parse(voucher.startsAt) <= now && Date.parse(voucher.endsAt) > now && voucher.redeemedCount < voucher.quantity;
    assert.ok(vouchers.some((voucher) => active(voucher) && voucher.type === "PERCENT" && voucher.percent === 10 && vnd(voucher.maxDiscount) === 200000 && voucher.isListed));
    assert.ok(vouchers.some((voucher) => active(voucher) && voucher.type === "PERCENT" && voucher.percent === 5 && vnd(voucher.maxDiscount) === 500000));
    assert.ok(vouchers.some((voucher) => active(voucher) && voucher.type === "FREE_SHIPPING" && voucher.isListed));
    assert.ok(vouchers.some((voucher) => !voucher.isEnabled));
    assert.ok(vouchers.some((voucher) => voucher.redeemedCount === voucher.quantity && voucher.quantity > 0));
    assert.equal(byCode.get("VIP25").isListed, false);
    assert.ok(active(byCode.get("VIP25")));
    assert.match(byCode.get("NEW10").description, /Giảm 10%, tối đa 200\.000₫/);
});

test("order voucher discounts follow the redemption rules and sum to the order discount", () => {
    const withVouchers = orders.filter((order) => order.vouchers.length > 0);
    assert.ok(withVouchers.length >= 8 && withVouchers.length <= 12);
    assert.ok(withVouchers.some((order) => order.vouchers.length === 2 && order.vouchers.some((used) => used.type === "PERCENT") && order.vouchers.some((used) => used.type === "FREE_SHIPPING")));
    assert.ok(withVouchers.some((order) => order.vouchers.length === 3));
    const byCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    for (const order of withVouchers) {
        assert.ok(order.vouchers.length <= 3);
        assert.ok(order.vouchers.filter((used) => used.type === "FREE_SHIPPING").length <= 1);
        assert.equal(new Set(order.vouchers.map((used) => used.code)).size, order.vouchers.length);
        const subtotal = vnd(order.subtotal);
        let total = 0;
        let goods = 0;
        for (const used of order.vouchers) {
            const voucher = byCode.get(used.code);
            const amount = vnd(used.discountAmount);
            assert.equal(used.type, voucher.type);
            assert.equal(used.percent, voucher.percent);
            total += amount;
            if (used.type === "PERCENT") {
                goods += amount;
                assert.equal(amount, Math.min(Math.floor((subtotal * voucher.percent) / 100), vnd(voucher.maxDiscount)));
            } else {
                assert.equal(amount, SHIPPING_FEE);
            }
            assert.ok(amount <= 500000);
            assert.ok(Date.parse(order.createdAt) >= Date.parse(voucher.startsAt) && Date.parse(order.createdAt) <= Date.parse(voucher.endsAt));
            assert.equal(used.releasedAt !== null, order.orderStatus === "CANCELLED");
        }
        assert.equal(total, vnd(order.discount));
        assert.ok(goods <= subtotal);
        assert.ok(total <= 1000000);
        assert.ok(vnd(order.totalPrice) >= 1000);
    }
    assert.ok(withVouchers.some((order) => order.orderStatus === "CANCELLED"));
    for (const order of orders.filter((entry) => entry.vouchers.length === 0)) assert.equal(vnd(order.discount), 0);
});

test("every product has at least four distinct delivered buyers", () => {
    for (const product of products) {
        const buyers = new Set(delivered.filter((order) => orderProducts(order).has(product.id)).map((order) => order.userId));
        assert.ok(buyers.size >= 4, `${product.name} has ${buyers.size} buyers`);
    }
});

test("reviews come from verified buyers, once per product, after the delivered order", () => {
    assert.ok(reviews.length >= 40);
    const keys = new Set();
    const comments = new Map();
    for (const review of reviews) {
        const key = `${review.productId}|${review.userId}`;
        assert.equal(keys.has(key), false, `duplicate review ${key}`);
        keys.add(key);
        assert.ok(review.rating === null || (Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5));
        if (review.rating === null) assert.ok(review.comment && review.comment.trim().length > 0);
        if (review.comment !== null) {
            assert.ok(review.comment.length <= 1000);
            const seen = comments.get(review.productId) || new Set();
            assert.equal(seen.has(review.comment), false, "a product must not repeat a comment");
            seen.add(review.comment);
            comments.set(review.productId, seen);
        }
        const verified = delivered.filter((order) => order.userId === review.userId && orderProducts(order).has(review.productId));
        assert.ok(verified.length > 0, `${key} has no delivered order`);
        assert.ok(verified.some((order) => Date.parse(review.createdAt) > Date.parse(order.updatedAt)), `${key} predates the delivery`);
        assert.ok(Date.parse(review.createdAt) <= Date.now());
    }
});

test("review mix: Vietnamese comment pool, one hidden review, varied product averages", () => {
    assert.equal(reviews.filter((review) => review.isHidden).length, 1);
    assert.ok(reviews.some((review) => review.rating !== null && review.comment === null));
    assert.ok(reviews.some((review) => review.rating === null && review.comment !== null));
    assert.ok(new Set(reviews.filter((review) => review.comment).map((review) => review.comment)).size >= 40);
    assert.ok(COMMENT_POOL_SIZE >= 40);
    assert.ok(reviews.every((review) => !review.comment || /[À-ỹ]/.test(review.comment)));
    const perProduct = new Map(products.map((product) => [product.id, reviews.filter((review) => review.productId === product.id)]));
    const counts = [...perProduct.values()].map((list) => list.length);
    assert.equal(counts.filter((count) => count === 0).length, 1);
    for (const count of counts.filter((entry) => entry > 0)) assert.ok(count >= 3 && count <= 8);
    const averages = [...perProduct.values()].map((list) => {
        const rated = list.filter((review) => !review.isHidden && review.rating !== null);
        return rated.length === 0 ? null : rated.reduce((sum, review) => sum + review.rating, 0) / rated.length;
    });
    assert.equal(averages.filter((average) => average === null).length, 2, "one product without reviews and one with comment-only reviews");
    const values = averages.filter((average) => average !== null);
    assert.ok(Math.max(...values) - Math.min(...values) >= 1.2);
    assert.ok(reviews.filter((review) => review.rating >= 4).length > reviews.filter((review) => review.rating !== null && review.rating <= 3).length);
    assert.ok(reviews.some((review) => review.rating !== null && review.rating <= 2));
});

test("normalization accepts the generated data and rejects broken invariants", () => {
    const normalized = normalizeSeedData(seedData.commerce);
    assert.equal(normalized.orders.length, 48);
    assert.equal(normalized.reviews.length, reviews.length);
    const broken = (mutate) => {
        const copy = structuredClone(seedData.commerce);
        mutate(copy);
        return () => normalizeSeedData(copy);
    };
    assert.throws(broken((data) => { data.vouchers[0].redeemedCount += 1; }), SeedDataError);
    assert.throws(broken((data) => { data.reviews[0].userId = "missing"; }), SeedDataError);
    assert.throws(broken((data) => { data.reviews.push({ ...data.reviews[0] }); }), /duplicates another review/);
    assert.throws(broken((data) => { data.reviews[0].rating = null; data.reviews[0].comment = null; }), /rating or a comment/);
    const withDiscount = orders.findIndex((order) => order.vouchers.length > 0);
    assert.throws(broken((data) => { data.orders[withDiscount].vouchers[0].discountAmount = "1.00"; }), /sum of the order voucher/);
    assert.throws(broken((data) => { data.orders[0].items[0].variantSku = "MISSING"; }), SeedDataError);
});

test("seed classification reports unchanged rows on re-run and conflicts instead of overwriting", () => {
    const normalized = normalizeSeedData(seedData.commerce);
    normalized.orders = resolveSeedOrderItems(normalized.products, normalized.orders);

    const run = (existing) => {
        const summary = createSummary(normalized);
        const conflicts = [];
        const inserts = {
            users: classifyUsers(normalized.users, existing.users, conflicts, summary),
            vouchers: classifyVouchers(normalized.vouchers, existing.vouchers, conflicts, summary),
            orders: classifyOrders(normalized.orders, existing.orders, existing.items, existing.orderVouchers, conflicts, summary),
            reviews: classifyReviews(normalized.reviews, existing.reviews, conflicts, summary)
        };
        return { summary, conflicts, inserts };
    };

    const empty = run({ users: [], vouchers: [], orders: [], items: [], orderVouchers: [], reviews: [] });
    assert.equal(empty.inserts.users.length, 12);
    assert.equal(empty.inserts.vouchers.length, 8);
    assert.equal(empty.inserts.orders.length, 48);
    assert.equal(empty.inserts.reviews.length, reviews.length);
    assert.equal(empty.conflicts.length, 0);

    const existing = {
        users: normalized.users.map((user) => ({ id: user.id, email: user.email, username: user.username, role: user.role, status: user.status })),
        vouchers: normalized.vouchers.map((voucher) => ({ ...voucher })),
        orders: normalized.orders.map((order) => ({
            ...order,
            customerName: order.customerName
        })),
        items: normalized.orders.flatMap((order) => order.items.map((item) => ({
            ...item, orderId: order.id, skuSnapshot: item.variantSku
        }))),
        orderVouchers: normalized.orders.flatMap((order) => order.vouchers.map((voucher) => ({
            orderId: order.id,
            codeSnapshot: voucher.code,
            typeSnapshot: voucher.type,
            percentSnapshot: voucher.percent,
            discountAmount: voucher.discountAmount
        }))),
        reviews: normalized.reviews.map((review) => ({ ...review }))
    };
    const again = run(existing);
    assert.equal(again.conflicts.length, 0, JSON.stringify(again.conflicts));
    assert.deepEqual(Object.values(again.inserts).map((list) => list.length), [0, 0, 0, 0]);
    assert.equal(again.summary.unchanged.users, 12);
    assert.equal(again.summary.unchanged.vouchers, 8);
    assert.equal(again.summary.unchanged.orders, 48);
    assert.equal(again.summary.unchanged.orderVouchers, normalized.orders.reduce((sum, order) => sum + order.vouchers.length, 0));
    assert.equal(again.summary.unchanged.reviews, reviews.length);

    const changed = structuredClone(existing);
    changed.vouchers[0].percent = 99;
    changed.reviews[0].rating = (changed.reviews[0].rating || 0) === 5 ? 4 : 5;
    changed.users[0].username = "someone_else";
    const conflicted = run(changed);
    assert.deepEqual(conflicted.conflicts.map(({ identity, field }) => `${identity}:${field}`).sort(), [
        `review:${normalized.reviews[0].productId}/${normalized.reviews[0].userId}:rating`,
        `user:${normalized.users[0].id}:username`,
        `voucher:${normalized.vouchers[0].code}:percent`
    ].sort());
});

// ── Full names, address books, loyalty points and status history ────────────

test("every demo customer has a full name and an address book with exactly one default (the checkout pre-fill)", () => {
    for (const user of users) {
        assert.ok(user.fullName && user.fullName.length >= 2, user.username);
        assert.ok(user.addresses.length >= 1 && user.addresses.length <= 10);
        assert.equal(user.addresses.filter((address) => address.isDefault).length, 1);
        for (const address of user.addresses) assert.match(address.phone, /^(0|\+84)[0-9]{8,10}$/);
    }
    assert.ok(users.some((user) => user.addresses.length > 1), "at least one customer shows several saved addresses");
    const ids = users.flatMap((user) => user.addresses.map((address) => address.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.length === 36));
});

test("loyalty points: each order stores floor(10% of its total / 1000) and each balance is the sum of the credited orders", () => {
    const worked = (total) => Math.floor(total / 10 / 1000); // 1,000,000 VND -> 100 points
    const balances = new Map(users.map((user) => [user.id, 0]));
    for (const order of orders) {
        assert.equal(order.pointsEarned, worked(vnd(order.totalPrice)), order.id);
        const online = ["MOMO", "VNPAY"].includes(order.paymentMethod);
        const shouldCredit = order.orderStatus !== "CANCELLED" && order.paymentStatus === "PAID" && (order.orderStatus === "DELIVERED" || online);
        assert.equal(order.pointsCreditedAt !== null, shouldCredit, `${order.id} ${order.orderStatus} ${order.paymentMethod}`);
        if (shouldCredit) balances.set(order.userId, balances.get(order.userId) + order.pointsEarned);
    }
    for (const user of users) assert.equal(user.loyaltyPoints, balances.get(user.id), user.username);
    assert.ok(users.every((user) => user.loyaltyPoints > 0), "every demo customer has points to spend");
    assert.ok(orders.some((order) => order.pointsEarned > 0 && order.pointsCreditedAt === null), "some demo orders still wait to credit their points");
});

test("every demo order has a status history that starts PENDING, ends on its status and never goes back in time", () => {
    for (const order of orders) {
        const history = order.statusHistory;
        assert.equal(history[0].status, "PENDING", order.id);
        assert.equal(history[history.length - 1].status, order.orderStatus, order.id);
        assert.equal(history[0].at, order.createdAt);
        for (let index = 1; index < history.length; index += 1) {
            assert.ok(Date.parse(history[index].at) >= Date.parse(history[index - 1].at), `${order.id} step ${index}`);
        }
        assert.ok(Date.parse(history[history.length - 1].at) <= Date.now() + 1000);
    }
    const delivered = orders.find((order) => order.orderStatus === "DELIVERED");
    assert.deepEqual(delivered.statusHistory.map((entry) => entry.status), ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"]);
    assert.deepEqual(orders.find((order) => order.orderStatus === "CANCELLED").statusHistory.map((entry) => entry.status), ["PENDING", "CANCELLED"]);
});

test("normalization rejects a balance that does not match the credited orders and a history that ends elsewhere", () => {
    const broken = (mutate) => {
        const copy = structuredClone(seedData.commerce);
        mutate(copy);
        return () => normalizeSeedData(copy);
    };
    assert.throws(broken((data) => { data.users[0].loyaltyPoints += 1; }), /loyaltyPoints must equal/);
    assert.throws(broken((data) => { data.orders[0].statusHistory.pop(); }), /end with the order status/);
    assert.throws(broken((data) => { data.orders[0].pointsEarned += 1; }), /pointsEarned must be/);
    assert.throws(broken((data) => { data.users[0].addresses.forEach((address) => { address.isDefault = false; }); }), /exactly one default/);
});

// A transaction double that answers the backfill's lookups and records every write.
const backfillDouble = ({ addressCount = 0, historyCount = 0, pointsRows = 1 } = {}) => {
    const writes = [];
    return {
        writes,
        request() {
            const values = {};
            return {
                input(name, _type, value) { values[name] = value; },
                async query(text) {
                    const statement = text.replace(/\s+/g, " ").trim();
                    if (/FROM \[dbo\]\.\[user_addresses\]/.test(statement)) return { recordset: [{ count: addressCount }] };
                    if (/FROM \[dbo\]\.\[order_status_history\]/.test(statement)) return { recordset: [{ count: historyCount }] };
                    const rowsAffected = [/^UPDATE \[dbo\]\.\[orders\]/.test(statement) ? pointsRows : 1];
                    writes.push({ statement, values });
                    return { recordset: [], rowsAffected };
                }
            };
        }
    };
};
const tableOf = (write) => write.statement.match(/\[dbo\]\.\[(\w+)\]/)[1];

test("backfill fills a previously seeded database: names, address book, history and the points of credited orders", async () => {
    const user = users[0];
    const credited = orders.find((order) => order.userId === user.id && order.pointsCreditedAt !== null);
    const double = backfillDouble();
    await backfillSeedExtras(double, [user], [credited]);

    const inserted = (table) => double.writes.filter((write) => tableOf(write) === table && /^INSERT/.test(write.statement));
    assert.equal(inserted("user_addresses").length, user.addresses.length);
    assert.equal(inserted("order_status_history").length, credited.statusHistory.length);
    const balance = double.writes.find((write) => /SET \[loyalty_points\] = \[loyalty_points\] \+ @pointsEarned/.test(write.statement));
    assert.equal(balance.values.pointsEarned, credited.pointsEarned);
    assert.equal(balance.values.userId, user.id);
});

test("backfill is idempotent: a populated database gets no inserts and no second credit", async () => {
    const user = users[0];
    const credited = orders.find((order) => order.userId === user.id && order.pointsCreditedAt !== null);
    const double = backfillDouble({ addressCount: 2, historyCount: 4, pointsRows: 0 });
    await backfillSeedExtras(double, [user], [credited]);
    assert.equal(double.writes.some((write) => /^INSERT/.test(write.statement)), false);
    assert.equal(double.writes.some((write) => /loyalty_points/.test(write.statement)), false, "points already recorded: the balance is not touched again");
});

test("backfill records the points of an order that is not credited yet without touching the balance", async () => {
    const waiting = orders.find((order) => order.pointsCreditedAt === null && order.pointsEarned > 0);
    const double = backfillDouble({ historyCount: 1 });
    await backfillSeedExtras(double, [], [waiting]);
    assert.ok(double.writes.some((write) => /^UPDATE \[dbo\]\.\[orders\]/.test(write.statement) && write.values.pointsCreditedAt === null));
    assert.equal(double.writes.some((write) => /loyalty_points/.test(write.statement)), false);
});

test("every normalized seed variant and order line has a cost below the selling price", () => {
    const normalized = normalizeSeedData({ products, users, vouchers, orders, reviews, audits: seedData.commerce.audits });
    const resolved = resolveSeedOrderItems(normalized.products, normalized.orders);
    for (const order of resolved) {
        for (const item of order.items) {
            assert.ok(Number(item.unitCost) > 0 && Number(item.unitCost) < Number(item.unitPrice), `${item.variantSku} unitCost`);
        }
    }
    for (const product of normalized.products) {
        for (const variant of product.variants) {
            const cost = Number(variant.costPrice);
            assert.ok(cost > 0 && cost < Number(variant.price), `${variant.sku} costPrice must be between 0 and price`);
        }
    }
});

test("every sample product shows at least three different photos: the main one plus a numbered gallery whose files exist", () => {
    const normalized = normalizeSeedData({ products, users, vouchers, orders, reviews, audits: seedData.commerce.audits });
    assert.equal(normalized.products.length, 24);
    for (const product of normalized.products) {
        const urls = [product.image, ...product.images.map((image) => image.url)];
        assert.ok(product.images.length >= 2, `${product.name} needs at least two gallery photos`);
        assert.equal(new Set(urls).size, urls.length, `${product.name} repeats a photo`);
        assert.deepEqual(product.images.map((image) => image.position), product.images.map((_, index) => index + 1), `${product.name} gallery positions`);
        for (const url of urls) {
            assert.match(url, /^\/uploads\/products\/[\w.-]+\.(?:png|jpg)$/, url);
            assert.ok(existsSync(path.join(__dirname, "..", "data", "product-images", path.basename(url))), url);
        }
    }
    const everyFile = normalized.products.flatMap((product) => product.images.map((image) => image.url));
    assert.equal(new Set(everyFile).size, everyFile.length, "a gallery photo is shared by two products");
});

test("seed normalization rejects a gallery that repeats a photo or a position", () => {
    const [product] = products;
    const normalize = (images) => normalizeSeedData({ products: [{ ...product, images }], users: [], vouchers: [], orders: [], reviews: [], audits: [] });
    assert.throws(() => normalize([{ url: "/uploads/products/a.png", position: 1 }, { url: "/uploads/products/a.png", position: 2 }]), SeedDataError);
    assert.throws(() => normalize([{ url: "/uploads/products/a.png", position: 1 }, { url: "/uploads/products/b.png", position: 1 }]), SeedDataError);
    assert.deepEqual(normalize([{ url: "/uploads/products/b.png", position: 2 }, { url: "/uploads/products/a.png", position: 1 }]).products[0].images.map((image) => image.position), [1, 2]);
});

test("gallery backfill fills a product that has no gallery rows and leaves an edited one alone", async () => {
    const [product] = normalizeSeedData({ products: products.slice(0, 1), users: [], vouchers: [], orders: [], reviews: [], audits: [] }).products;
    const run = async (existingCount) => {
        const writes = [];
        const double = {
            request() {
                const values = {};
                return {
                    input(name, _type, value) { values[name] = value; },
                    async query(text) {
                        const statement = text.replace(/\s+/g, " ").trim();
                        if (/COUNT_BIG/.test(statement)) return { recordset: [{ count: existingCount }] };
                        writes.push({ statement, values });
                        return { recordset: [], rowsAffected: [1] };
                    }
                };
            }
        };
        const filled = await backfillProductImages(double, [product]);
        return { filled, writes };
    };
    const empty = await run(0);
    assert.equal(empty.filled, product.images.length);
    assert.deepEqual(empty.writes.map((write) => write.values.url), product.images.map((image) => image.url));
    assert.ok(empty.writes.every((write) => /^INSERT INTO \[dbo\]\.\[product_images\]/.test(write.statement)));
    const populated = await run(2);
    assert.equal(populated.filled, 0);
    assert.equal(populated.writes.length, 0);
});
