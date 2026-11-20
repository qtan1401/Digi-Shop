const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const seedData = require("../prisma/seed-data");
const { COMMENT_POOL_SIZE, buildSeedFixtures } = require("../prisma/seed-fixtures");
const { normalizeSeedData, SeedDataError } = require("../scripts/db/normalize-seed");
const {
    backfillProductImages, backfillSeedExtras, classifyOrders, classifyReviews, classifyUsers, classifyVouchers, createSummary,
    insertBatch, insertOrders, resolveSeedOrderItems
} = require("../prisma/seed");
const { POINT_VALUE } = require("../src/services/loyalty-calculator");

const { products, users, vouchers, orders, reviews } = seedData.commerce;
const SHIPPING_FEE = 100000;
const DAY = 24 * 60 * 60 * 1000;
const skuToProduct = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.sku, product.id])));
const orderProducts = (order) => new Set(order.items.map((item) => skuToProduct.get(item.variantSku)));
const delivered = orders.filter((order) => order.orderStatus === "DELIVERED");
const vnd = (text) => Number(text.replace(/\.00$/, ""));
const HOUR = 60 * 60 * 1000;
const TODAY = new Date("2026-11-20T10:00:00Z");
const LATER = new Date(TODAY.getTime() + 400 * DAY);
const fixtureCache = new Map();
const fixturesAt = (reference) => {
    if (!fixtureCache.has(reference.getTime())) fixtureCache.set(reference.getTime(), buildSeedFixtures(products, reference));
    return fixtureCache.get(reference.getTime());
};
// Calendar month / year in shop time (UTC+7), as the dashboard groups them.
const shopMonth = (iso) => new Date(Date.parse(iso) + 7 * HOUR).toISOString().slice(0, 7);
const shopYear = (iso) => Number(shopMonth(iso).slice(0, 4));
// Revenue order (GLOSSARY): PAID or DELIVERED and not CANCELLED.
const isRevenue = (order) => order.orderStatus !== "CANCELLED" && (order.paymentStatus === "PAID" || order.orderStatus === "DELIVERED");
const productOf = (item) => products.find((product) => product.id === skuToProduct.get(item.variantSku));

test("seed fixtures are deterministic: the same reference time gives the same data and a later one extends the history", () => {
    const reference = new Date("2026-11-05T10:00:00Z");
    const first = buildSeedFixtures(products, reference);
    assert.deepEqual(buildSeedFixtures(products, reference), first);
    const later = buildSeedFixtures(products, new Date(reference.getTime() + 30 * DAY));
    // Everything older than the moving window (the last weeks' sign-ups, the last 48 hours) is the same order, in the same place.
    const settled = (fixtures) => fixtures.orders
        .filter((order) => Date.parse(order.createdAt) < reference.getTime() - 45 * DAY)
        .map(({ id, userId, items, createdAt, updatedAt, orderStatus, paymentStatus, paymentMethod, customer, statusHistory }) =>
            ({ id, userId, items, createdAt, updatedAt, orderStatus, paymentStatus, paymentMethod, customer, statusHistory }));
    assert.ok(settled(first).length > 600);
    assert.deepEqual(settled(later), settled(first));
    assert.ok(later.orders.length > first.orders.length, "a later run appends the days in between");
    const founders = (fixtures) => fixtures.users
        .filter((user) => Date.parse(user.createdAt) < reference.getTime() - 45 * DAY)
        .map(({ id, email, username, createdAt }) => ({ id, email, username, createdAt }));
    assert.deepEqual(founders(later), founders(first));
    assert.ok(founders(first).length >= 50);
});

test("seed customers are active, verified, password-less @seed.local accounts", () => {
    assert.ok(users.length >= 55 && users.length <= 65, `${users.length} customers`);
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
    assert.equal(new Set(users.map((user) => user.email)).size, users.length);
});

test("the twelve founding demo accounts keep their ids, e-mails and usernames; new customers join over two years with spikes", () => {
    const founding = [
        ["minh.tran@seed.local", "minh_tran92"], ["hoa.nguyen@seed.local", "hoa.nguyen"], ["quang.vu@seed.local", "quangvu"],
        ["trang.le@seed.local", "trangle_hn"], ["anh.pham@seed.local", "ducanh.pham"], ["hai.hoang@seed.local", "haihoang88"],
        ["lan.dang@seed.local", "lan.dang"], ["bao.bui@seed.local", "baobui_sg"], ["linh.do@seed.local", "khanhlinh"],
        ["huy.ngo@seed.local", "giahuy.ngo"], ["duyen.duong@seed.local", "myduyen97"], ["kiet.phan@seed.local", "tuankiet_pn"]
    ];
    founding.forEach(([email, username], index) => {
        assert.equal(users[index].email, email);
        assert.equal(users[index].username, username);
        assert.equal(users[index].id, `5eed0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    });
    for (const reference of [TODAY, LATER]) {
        const { users: customers } = fixturesAt(reference);
        const signups = customers.map((user) => Date.parse(user.createdAt));
        assert.equal(shopMonth(customers[0].createdAt), "2024-11");
        assert.ok(signups.every((time) => time <= reference.getTime()));
        const perMonth = new Map();
        for (const user of customers.slice(founding.length)) perMonth.set(shopMonth(user.createdAt), (perMonth.get(shopMonth(user.createdAt)) || 0) + 1);
        assert.ok(perMonth.size >= 18, `new customers appear in ${perMonth.size} different months`);
        const counts = [...perMonth.values()];
        assert.ok(Math.max(...counts) >= 3 * Math.min(...counts), "some months have a spike of sign-ups");
        const lastWeek = customers.filter((user) => reference.getTime() - Date.parse(user.createdAt) <= 7 * DAY);
        assert.ok(lastWeek.length >= 1, "there are new customers in the last week");
    }
});

test("every order has consistent totals, a stable id, and the fixed shipping fee", () => {
    const historyDays = (Date.now() - Date.parse("2024-10-31T17:00:00Z")) / DAY;
    assert.ok(orders.length >= historyDays * 0.9 && orders.length <= historyDays * 2.5, `${orders.length} orders over ${Math.round(historyDays)} days`);
    assert.ok(delivered.length >= Math.ceil(products.length * 4 / 3));
    assert.ok(delivered.length < orders.length);
    assert.equal(new Set(orders.map((order) => order.id)).size, orders.length);
    for (const order of orders) {
        assert.match(order.id, /^ORD-[0-9A-Z]+-[0-9A-Z]{5}$/);
        const subtotal = order.items.reduce((sum, item) => sum + vnd(item.lineTotal), 0);
        for (const item of order.items) assert.equal(vnd(item.unitPrice) * item.quantity, vnd(item.lineTotal));
        assert.equal(vnd(order.subtotal), subtotal);
        assert.equal(vnd(order.shippingFee), SHIPPING_FEE);
        assert.equal(vnd(order.totalPrice), vnd(order.subtotal) + SHIPPING_FEE - vnd(order.discount) - vnd(order.pointsDiscount));
        assert.ok(vnd(order.totalPrice) >= 1000);
        assert.ok(["COD", "MOMO", "VNPAY"].some((method) => order.paymentMethod === method || order.paymentMethod === "Thanh toán khi nhận hàng (COD)"));
        assert.ok(users.some((user) => user.id === order.userId));
    }
    const times = orders.map((order) => Date.parse(order.createdAt));
    assert.deepEqual(times, [...times].sort((left, right) => left - right), "orders are listed oldest first");
});

test("delivered orders are at least three days old and the last 48 hours cover every other state", () => {
    const { orders: list } = fixturesAt(TODAY);
    const now = TODAY.getTime();
    const deliveredList = list.filter((order) => order.orderStatus === "DELIVERED");
    for (const order of deliveredList) {
        assert.equal(order.paymentStatus, "PAID");
        assert.ok(now - Date.parse(order.createdAt) >= 3 * DAY, `${order.id} was delivered too early`);
    }
    for (const order of list) assert.ok(Date.parse(order.updatedAt) <= now, `${order.id} was updated in the future`);
    const recent = list.filter((order) => now - Date.parse(order.createdAt) <= 48 * 60 * 60 * 1000);
    assert.equal(recent.length, 8);
    assert.deepEqual([...new Set(recent.map((order) => order.orderStatus))].sort(), ["CANCELLED", "PENDING", "PROCESSING", "SHIPPED"]);
    const stale = (order) => now - Date.parse(order.createdAt) > 24 * 60 * 60 * 1000;
    assert.ok(recent.some((order) => order.orderStatus === "PENDING" && order.paymentStatus === "UNPAID" && order.paymentMethod.includes("COD") && stale(order)));
    assert.ok(recent.some((order) => order.orderStatus === "PENDING" && order.paymentStatus === "PAID" && ["MOMO", "VNPAY"].includes(order.paymentMethod) && stale(order)));
    assert.ok(recent.some((order) => order.orderStatus === "CANCELLED" && order.paymentStatus === "REFUNDED"));
    for (const order of recent) assert.equal(order.pointsRedeemed, 0);

    // Older orders: mostly delivered, a share cancelled, every payment method in use.
    const settled = list.filter((order) => now - Date.parse(order.createdAt) > 14 * DAY);
    const share = (status) => settled.filter((order) => order.orderStatus === status).length / settled.length;
    assert.ok(share("DELIVERED") > 0.8 && share("DELIVERED") < 0.97, `delivered share ${share("DELIVERED")}`);
    assert.ok(share("CANCELLED") > 0.04 && share("CANCELLED") < 0.2, `cancelled share ${share("CANCELLED")}`);
    assert.ok(settled.every((order) => ["DELIVERED", "CANCELLED"].includes(order.orderStatus)), "nothing is left open after two weeks");
    assert.deepEqual([...new Set(settled.map((order) => order.paymentMethod))].sort(), ["MOMO", "Thanh toán khi nhận hàng (COD)", "VNPAY"]);
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
    assert.ok(withVouchers.length >= 8 && withVouchers.length < orders.length / 10, "some orders use vouchers, most do not");
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
    const wired = new Set(products.filter((product) =>
        ["keyboard", "mouse"].includes(product.deviceType) && !product.tags.includes("khong-day")).map((product) => product.id));
    for (const review of reviews.filter((entry) => wired.has(entry.productId) && entry.comment !== null)) {
        assert.doesNotMatch(review.comment, /pin|Bluetooth|không dây|ghép nối|chuyển giữa máy tính/i);
    }
    const perProduct = new Map(products.map((product) => [product.id, reviews.filter((review) => review.productId === product.id)]));
    const counts = [...perProduct.values()].map((list) => list.length);
    assert.equal(perProduct.get(504).length, 0, "Razer Viper V3 Pro has no reviews");
    assert.ok(perProduct.get(405).every((review) => review.rating === null && review.comment), "Keychron K2 V2 has comment-only reviews");
    assert.equal(reviews.find((review) => review.isHidden).productId, 402);
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
    assert.equal(normalized.orders.length, orders.length);
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
    assert.equal(empty.inserts.users.length, users.length);
    assert.equal(empty.inserts.vouchers.length, vouchers.length);
    assert.equal(empty.inserts.orders.length, orders.length);
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
    assert.equal(again.summary.unchanged.users, users.length);
    assert.equal(again.summary.unchanged.vouchers, vouchers.length);
    assert.equal(again.summary.unchanged.orders, orders.length);
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

test("loyalty points: each order stores floor(10% of its total / 1000) and each balance is the credited points minus the redeemed ones", () => {
    const worked = (total) => Math.floor(total / 10 / 1000); // 1,000,000 VND -> 100 points
    const balances = new Map(users.map((user) => [user.id, 0]));
    for (const order of orders) {
        assert.equal(order.pointsEarned, worked(vnd(order.totalPrice)), order.id);
        const online = ["MOMO", "VNPAY"].includes(order.paymentMethod);
        const shouldCredit = order.orderStatus !== "CANCELLED" && order.paymentStatus === "PAID" && (order.orderStatus === "DELIVERED" || online);
        assert.equal(order.pointsCreditedAt !== null, shouldCredit, `${order.id} ${order.orderStatus} ${order.paymentMethod}`);
        if (shouldCredit) balances.set(order.userId, balances.get(order.userId) + order.pointsEarned);
        if (order.pointsRedeemed > 0 && order.pointsReleasedAt === null) balances.set(order.userId, balances.get(order.userId) - order.pointsRedeemed);
    }
    for (const user of users) assert.equal(user.loyaltyPoints, balances.get(user.id), user.username);
    assert.ok(users.slice(0, 12).every((user) => user.loyaltyPoints > 0), "every founding customer has points to spend");
    assert.ok(orders.some((order) => order.pointsEarned > 0 && order.pointsCreditedAt === null), "some demo orders still wait to credit their points");
});

test("loyalty points redeemed on orders are legal: 1.000 VND each, within the balance at that moment, returned once by a cancellation", () => {
    for (const reference of [TODAY, LATER]) {
        const { users: customers, orders: list } = fixturesAt(reference);
        const events = new Map(customers.map((user) => [user.id, []]));
        let redeemedOrders = 0;
        let released = 0;
        for (const order of list) {
            const redeemed = order.pointsRedeemed;
            assert.equal(vnd(order.pointsDiscount), redeemed * POINT_VALUE, order.id);
            assert.equal(vnd(order.totalPrice), vnd(order.subtotal) + SHIPPING_FEE - vnd(order.discount) - vnd(order.pointsDiscount), order.id);
            assert.ok(vnd(order.pointsDiscount) <= (vnd(order.subtotal) + SHIPPING_FEE - vnd(order.discount)) * 0.4 + POINT_VALUE, `${order.id} points cover too much`);
            if (redeemed === 0) {
                assert.equal(order.pointsReleasedAt, null);
                continue;
            }
            redeemedOrders += 1;
            assert.equal(order.pointsReleasedAt !== null, order.orderStatus === "CANCELLED", order.id);
            events.get(order.userId).push({ at: Date.parse(order.createdAt), points: -redeemed });
            if (order.pointsReleasedAt !== null) {
                released += 1;
                events.get(order.userId).push({ at: Date.parse(order.pointsReleasedAt), points: redeemed });
            }
        }
        for (const order of list) {
            if (order.pointsCreditedAt !== null) events.get(order.userId).push({ at: Date.parse(order.pointsCreditedAt), points: order.pointsEarned });
        }
        for (const user of customers) {
            // Credits and refunds at the same instant count before a redemption; a balance never dips below zero.
            const moves = events.get(user.id).sort((left, right) => left.at - right.at || right.points - left.points);
            let balance = 0;
            for (const move of moves) {
                balance += move.points;
                assert.ok(balance >= 0, `${user.username} overspends points at ${new Date(move.at).toISOString()}`);
            }
            assert.equal(balance, user.loyaltyPoints, user.username);
        }
        assert.ok(redeemedOrders >= list.length * 0.05, "a share of the orders redeems points");
        assert.ok(released >= 1, "a cancelled order gave redeemed points back");
    }
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

// A transaction double for the seed backfill's PostgreSQL lookups and writes.
const backfillDouble = ({ addressCount = 0, historyCount = 0, pointsRows = 1 } = {}) => {
    const writes = [];
    return {
        writes,
        async query(text, values = []) {
            const statement = text.replace(/\s+/g, " ").trim();
            if (/FROM user_addresses/.test(statement)) return { rows: [{ count: addressCount }] };
            if (/FROM order_status_history/.test(statement)) return { rows: [{ count: historyCount }] };
            const rowCount = /^UPDATE orders/.test(statement) ? pointsRows : 1;
            writes.push({ statement, values });
            return { rows: [], rowCount };
        }
    };
};
const tableOf = (write) => write.statement.match(/^(?:INSERT INTO|UPDATE) (\w+)/)[1];

test("backfill fills a previously seeded database: names, address book, history and the points of credited orders", async () => {
    const user = users[0];
    const credited = orders.find((order) => order.userId === user.id && order.pointsCreditedAt !== null);
    const double = backfillDouble();
    await backfillSeedExtras(double, [user], [credited]);

    const inserted = (table) => double.writes.filter((write) => tableOf(write) === table && /^INSERT/.test(write.statement));
    assert.equal(inserted("user_addresses").length, user.addresses.length);
    assert.equal(inserted("order_status_history").length, credited.statusHistory.length);
    const balance = double.writes.find((write) => /SET loyalty_points = loyalty_points \+/.test(write.statement));
    assert.equal(balance.values[1], credited.pointsEarned);
    assert.equal(balance.values[0], user.id);
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
    assert.ok(double.writes.some((write) => /^UPDATE orders/.test(write.statement) && write.values[4] === null));
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
    assert.equal(normalized.products.length, products.length);
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
            async query(text, values = []) {
                const statement = text.replace(/\s+/g, " ").trim();
                if (/COUNT\(\*\)/.test(statement)) return { rows: [{ count: existingCount }] };
                writes.push({ statement, values });
                return { rows: [], rowCount: 1 };
            }
        };
        const filled = await backfillProductImages(double, [product]);
        return { filled, writes };
    };
    const empty = await run(0);
    assert.equal(empty.filled, product.images.length);
    assert.deepEqual(empty.writes.map((write) => write.values[1]), product.images.map((image) => image.url));
    assert.ok(empty.writes.every((write) => /^INSERT INTO product_images/.test(write.statement)));
    const populated = await run(2);
    assert.equal(populated.filled, 0);
    assert.equal(populated.writes.length, 0);
});

// ── Two-year demo history ────────────────────────────────────────────────────

test("orders span 2024-11 to the reference day: earliest by 2024-11-30 and orders in every month", () => {
    for (const reference of [TODAY, LATER]) {
        const { orders: list } = fixturesAt(reference);
        const counts = new Map();
        for (const order of list) counts.set(shopMonth(order.createdAt), (counts.get(shopMonth(order.createdAt)) || 0) + 1);
        assert.ok(Date.parse(list[0].createdAt) <= Date.parse("2024-11-30T16:59:59Z"), "the first order is placed in 2024-11");
        assert.equal(shopMonth(list[0].createdAt), "2024-11");
        const last = shopMonth(list[list.length - 1].createdAt);
        let [year, month] = [2024, 11];
        for (;;) {
            const key = `${year}-${String(month).padStart(2, "0")}`;
            assert.ok(counts.get(key) >= (key === last ? 1 : 10), `${key} has ${counts.get(key)} orders`);
            if (key === last) break;
            [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
        }
        assert.ok(list.length >= 600, `${list.length} orders`);
    }
});

test("revenue (paid or delivered, not cancelled) grows year over year and follows the seasons", () => {
    const revenueByYear = (list) => {
        const totals = new Map();
        for (const order of list.filter(isRevenue)) totals.set(shopYear(order.createdAt), (totals.get(shopYear(order.createdAt)) || 0) + vnd(order.totalPrice));
        return totals;
    };
    const today = revenueByYear(fixturesAt(TODAY).orders);
    assert.ok(today.get(2026) > today.get(2025), "2026 so far already beats the whole of 2025");
    assert.ok(today.get(2025) > today.get(2024));
    const later = revenueByYear(fixturesAt(LATER).orders);
    const growth = later.get(2026) / later.get(2025);
    assert.ok(growth >= 1.2 && growth <= 1.45, `2026 is ${Math.round((growth - 1) * 100)}% above 2025`);

    const monthly = new Map();
    for (const order of fixturesAt(LATER).orders.filter(isRevenue)) monthly.set(shopMonth(order.createdAt), (monthly.get(shopMonth(order.createdAt)) || 0) + 1);
    const average = (keys) => keys.reduce((sum, key) => sum + monthly.get(key), 0) / keys.length;
    const springAverage = average(["2025-03", "2025-04", "2025-05"]);
    assert.ok(average(["2025-06", "2025-07", "2025-08"]) > springAverage * 1.2, "back-to-school months sell more");
    assert.ok(monthly.get("2025-11") > monthly.get("2025-10") * 1.2, "Black Friday month sells more");
    assert.ok(average(["2025-12", "2026-01"]) > springAverage * 1.2, "the Tet shopping months sell more");
});

test("product mix: mice and keyboards sell the most units, laptops and monitors earn more per order, best seller is not the top earner", () => {
    for (const reference of [TODAY, LATER]) {
        const { orders: list } = fixturesAt(reference);
        const units = new Map();
        const earned = new Map();
        const typeUnits = new Map();
        const typeOrders = new Map();
        for (const order of list.filter(isRevenue)) {
            const types = new Set();
            for (const item of order.items) {
                const product = productOf(item);
                units.set(product.id, (units.get(product.id) || 0) + item.quantity);
                earned.set(product.id, (earned.get(product.id) || 0) + vnd(item.lineTotal));
                typeUnits.set(product.deviceType, (typeUnits.get(product.deviceType) || 0) + item.quantity);
                types.add(product.deviceType);
            }
            for (const type of types) typeOrders.set(type, [...(typeOrders.get(type) || []), vnd(order.totalPrice)]);
        }
        const total = [...typeUnits.values()].reduce((sum, value) => sum + value, 0);
        const peripherals = (typeUnits.get("mouse") + typeUnits.get("keyboard")) / total;
        assert.ok(peripherals > 0.5 && peripherals > 5 * (typeUnits.get("laptop") / total), `mice and keyboards are ${Math.round(peripherals * 100)}% of the units`);
        const averageOrder = (type) => typeOrders.get(type).reduce((sum, value) => sum + value, 0) / typeOrders.get(type).length;
        assert.ok(averageOrder("laptop") > averageOrder("mouse") && averageOrder("laptop") > averageOrder("keyboard"));
        assert.ok(averageOrder("monitor") > averageOrder("mouse"));
        const top = (totals) => [...totals.entries()].sort((left, right) => right[1] - left[1])[0][0];
        const byId = new Map(products.map((product) => [product.id, product]));
        assert.ok(["mouse", "keyboard"].includes(byId.get(top(units)).deviceType), "the best seller is a mouse or keyboard");
        assert.ok(["laptop", "monitor"].includes(byId.get(top(earned)).deviceType), "the top earner is a laptop or monitor");
        assert.notEqual(top(units), top(earned));
    }
});

test("history invariants hold on every run date: stock, deleted products, customers, vouchers, buyers and reviews", () => {
    for (const reference of [TODAY, LATER]) {
        const fixtures = fixturesAt(reference);
        const created = new Map(fixtures.users.map((user) => [user.id, Date.parse(user.createdAt)]));
        for (const product of products) for (const variant of product.variants) assert.ok(variant.stock >= 0, variant.sku);
        for (const order of fixtures.orders) {
            assert.ok(created.get(order.userId) < Date.parse(order.createdAt), `${order.id} predates its customer`);
            for (const item of order.items) {
                const product = productOf(item);
                assert.ok(!product.isDeleted || Date.parse(product.deletedAt) > Date.parse(order.createdAt), `${order.id} contains a deleted product`);
            }
        }
        for (const voucher of fixtures.vouchers) {
            const entries = fixtures.orders.flatMap((order) => order.vouchers).filter((used) => used.code === voucher.code);
            assert.ok(voucher.quantity <= 10 && entries.length <= voucher.quantity, voucher.code);
            assert.equal(voucher.redeemedCount, entries.filter((used) => used.releasedAt === null).length);
        }
        const deliveredOrders = fixtures.orders.filter((order) => order.orderStatus === "DELIVERED");
        for (const product of products) {
            const buyers = new Set(deliveredOrders.filter((order) => orderProducts(order).has(product.id)).map((order) => order.userId));
            assert.ok(buyers.size >= 4, `${product.name} has ${buyers.size} delivered buyers`);
        }
        // Reviews: the same profiles as ever, verified delivered buyers only, identical on a repeated build.
        assert.deepEqual(buildSeedFixtures(products, reference).reviews, fixtures.reviews);
        const reviewed = (id) => fixtures.reviews.filter((review) => review.productId === id);
        assert.equal(reviewed(504).length, 0);
        assert.ok(reviewed(405).length > 0 && reviewed(405).every((review) => review.rating === null && review.comment));
        assert.equal(fixtures.reviews.filter((review) => review.isHidden).length, 1);
        assert.equal(fixtures.reviews.find((review) => review.isHidden).productId, 402);
        for (const review of fixtures.reviews) {
            const verified = deliveredOrders.filter((order) => order.userId === review.userId && orderProducts(order).has(review.productId));
            assert.ok(verified.some((order) => Date.parse(review.createdAt) > Date.parse(order.updatedAt)), `${review.productId}|${review.userId}`);
            assert.ok(Date.parse(review.createdAt) <= reference.getTime());
        }
        normalizeSeedData({ ...seedData.commerce, users: fixtures.users, vouchers: fixtures.vouchers, orders: fixtures.orders, reviews: fixtures.reviews });
    }
});

test("insertBatch writes rows in chunks with one cast, numbered placeholder per value", async () => {
    const statements = [];
    const transaction = { query: async (statement, parameters) => { statements.push({ statement, parameters }); return { rows: [] }; } };
    const rows = Array.from({ length: 1201 }, (_, index) => [index, `name ${index}`, index % 2 === 0 ? null : new Date(index)]);
    await insertBatch(transaction, "things", [["id", "integer"], ["name", "varchar"], ["at", "timestamptz"]], rows);
    assert.deepEqual(statements.map(({ parameters }) => parameters.length / 3), [500, 500, 201]);
    assert.match(statements[0].statement, /^INSERT INTO things \(id, name, at\) VALUES \(\$1::integer, \$2::varchar, \$3::timestamptz\), \(\$4::integer/);
    assert.deepEqual(statements[2].parameters.slice(0, 3), [1000, "name 1000", null]);
    await insertBatch(transaction, "things", [["id", "integer"]], []);
    assert.equal(statements.length, 3, "no rows, no statement");
});

test("insertOrders sends orders, status history, lines and order vouchers as batches that carry every column and count", async () => {
    const normalized = normalizeSeedData(seedData.commerce);
    const records = resolveSeedOrderItems(normalized.products, normalized.orders);
    const statements = [];
    const transaction = {
        query: async (statement, parameters = []) => {
            statements.push({ statement: statement.replace(/\s+/g, " ").trim(), parameters });
            if (/FROM product_variants/.test(statement)) return { rows: parameters[0].map((sku, index) => ({ id: index + 1, sku })) };
            if (/FROM vouchers/.test(statement)) return { rows: parameters[0].map((code, index) => ({ id: index + 1, code })) };
            return { rows: [], rowCount: 1 };
        }
    };
    await insertOrders(transaction, records);
    const inserted = new Map();
    for (const { statement, parameters } of statements.filter(({ statement: text }) => text.startsWith("INSERT INTO"))) {
        const [, table, columns] = statement.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/);
        const width = columns.split(", ").length;
        const placeholders = [...statement.matchAll(/\$(\d+)::[\w()]+(?:,\d+\))?/g)].map((match) => Number(match[1]));
        assert.deepEqual(placeholders, parameters.map((_, index) => index + 1), `${table} placeholders are numbered once each, in order`);
        assert.equal(parameters.length % width, 0);
        assert.ok(parameters.length / width <= 500 && parameters.length <= 65535);
        const rows = inserted.get(table) || { columns: columns.split(", "), values: [] };
        for (let start = 0; start < parameters.length; start += width) rows.values.push(parameters.slice(start, start + width));
        inserted.set(table, rows);
    }
    const count = (pick) => records.reduce((sum, record) => sum + pick(record).length, 0);
    assert.equal(inserted.get("orders").values.length, records.length);
    assert.equal(inserted.get("order_status_history").values.length, count((record) => record.statusHistory));
    assert.equal(inserted.get("order_items").values.length, count((record) => record.items));
    assert.equal(inserted.get("order_vouchers").values.length, count((record) => record.vouchers));
    const { columns, values } = inserted.get("orders");
    const column = (row, name) => row[columns.indexOf(name)];
    values.forEach((row, index) => {
        const record = records[index];
        assert.equal(column(row, "id"), record.id);
        assert.equal(column(row, "points_redeemed"), record.pointsRedeemed);
        assert.equal(column(row, "points_discount"), record.pointsDiscount);
        assert.equal(column(row, "total_price"), record.totalPrice);
        assert.equal(column(row, "points_released_at")?.getTime() ?? null, record.pointsReleasedAt === null ? null : Date.parse(record.pointsReleasedAt));
        assert.equal(column(row, "cancelled_at")?.getTime() ?? null, record.orderStatus === "CANCELLED" ? Date.parse(record.updatedAt) : null);
    });
    const redeemed = new Map();
    for (const { statement, parameters } of statements.filter(({ statement: text }) => text.startsWith("UPDATE vouchers SET redeemed_count"))) {
        redeemed.set(parameters[0], parameters[1]);
    }
    assert.equal([...redeemed.values()].reduce((sum, value) => sum + value, 0), vouchers.reduce((sum, voucher) => sum + voucher.redeemedCount, 0));
});

test("normalization rejects redeemed points that break the total, the balance or the release rule", () => {
    const broken = (mutate) => {
        const copy = structuredClone(seedData.commerce);
        mutate(copy);
        return () => normalizeSeedData(copy);
    };
    const spent = orders.findIndex((order) => order.pointsRedeemed > 0 && order.pointsReleasedAt === null);
    const unspent = orders.findIndex((order) => order.pointsRedeemed === 0);
    assert.ok(spent >= 0 && unspent >= 0);
    assert.throws(broken((data) => { data.orders[spent].pointsRedeemed += 1; }), /loyaltyPoints must equal/);
    assert.throws(broken((data) => { data.orders[spent].pointsDiscount = "1.00"; }), /totalPrice must equal/);
    assert.throws(broken((data) => { data.orders[unspent].pointsReleasedAt = data.orders[unspent].updatedAt; }), /pointsReleasedAt needs redeemed points/);
    assert.throws(broken((data) => { data.orders[unspent].userId = null; data.orders[unspent].pointsRedeemed = 1; }), /without a customer/);
});
