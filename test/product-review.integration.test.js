const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://reviews.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

// ===== In-memory Prisma fake (only what the review/product code paths use) =====
let users;
let products;
let variants;
let orders;
let orderItems;
let reviews;
let audits;
let nextReviewId;
let clock;
let groupByCalls;

const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const missingRow = () => Object.assign(new Error("Record not found"), { code: "P2025" });
const textContains = (value, needle) => String(value ?? "").toLowerCase().includes(needle.toLowerCase());

const reviewRelations = (row) => ({
    ...row,
    user: { username: users.find((user) => user.id === row.userId)?.username ?? null },
    product: { name: products.find((product) => product.id === row.productId)?.name ?? null }
});

const reviewMatches = (row, where = {}) => {
    if (where.productId !== undefined) {
        const { productId } = where;
        if (typeof productId === "object" ? !productId.in.includes(row.productId) : row.productId !== productId) return false;
    }
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.isHidden !== undefined && row.isHidden !== where.isHidden) return false;
    if (where.rating?.not === null && row.rating === null) return false;
    if (where.comment?.not === null && row.comment === null) return false;
    if (where.OR) {
        const related = reviewRelations(row);
        const hit = where.OR.some((clause) =>
            (clause.comment && textContains(row.comment, clause.comment.contains)) ||
            (clause.user && textContains(related.user.username, clause.user.username.contains)) ||
            (clause.product && textContains(related.product.name, clause.product.name.contains)));
        if (!hit) return false;
    }
    return true;
};

const byNewest = (a, b) => b.createdAt - a.createdAt || b.id - a.id;

const fakePrisma = {
    user: {
        findUnique: async ({ where }) => {
            const row = users.find((user) => user.id === where.id);
            return row ? { ...row } : null;
        }
    },
    product: {
        findUnique: async ({ where }) => {
            const row = products.find((product) => product.id === where.id);
            return row ? { id: row.id, isDeleted: row.isDeleted } : null;
        }
    },
    orderItem: {
        findFirst: async ({ where }) => {
            const item = orderItems.find((candidate) => {
                const variant = variants.find((row) => row.id === candidate.variantId);
                const order = orders.find((row) => row.id === candidate.orderId);
                return variant?.productId === where.variant.productId &&
                    order?.userId === where.order.userId &&
                    order?.orderStatus === where.order.orderStatus;
            });
            return item ? { id: item.id } : null;
        }
    },
    productReview: {
        findUnique: async ({ where }) => {
            const key = where.productId_userId;
            const row = reviews.find((review) => key
                ? review.productId === key.productId && review.userId === key.userId
                : review.id === where.id);
            return row ? reviewRelations(row) : null;
        },
        create: async ({ data }) => {
            if (reviews.some((row) => row.productId === data.productId && row.userId === data.userId)) throw uniqueViolation();
            const row = { id: nextReviewId++, isHidden: false, createdAt: ++clock, updatedAt: clock, ...data };
            reviews.push(row);
            return { ...row, createdAt: new Date(row.createdAt * 1000), updatedAt: new Date(row.updatedAt * 1000) };
        },
        update: async ({ where, data }) => {
            const key = where.productId_userId;
            const row = reviews.find((review) => key
                ? review.productId === key.productId && review.userId === key.userId
                : review.id === where.id);
            if (!row) throw missingRow();
            Object.assign(row, data, { updatedAt: ++clock });
            return { ...row, createdAt: new Date(row.createdAt * 1000), updatedAt: new Date(row.updatedAt * 1000) };
        },
        deleteMany: async ({ where }) => {
            const before = reviews.length;
            reviews = reviews.filter((row) => !reviewMatches(row, where));
            return { count: before - reviews.length };
        },
        count: async ({ where }) => reviews.filter((row) => reviewMatches(row, where)).length,
        findMany: async ({ where, skip = 0, take }) => reviews
            .filter((row) => reviewMatches(row, where))
            .sort(byNewest)
            .slice(skip, take === undefined ? undefined : skip + take)
            .map((row) => ({
                ...reviewRelations(row),
                createdAt: new Date(row.createdAt * 1000),
                updatedAt: new Date(row.updatedAt * 1000)
            })),
        groupBy: async ({ by, where }) => {
            groupByCalls.push({ by, where });
            const groups = new Map();
            for (const row of reviews.filter((candidate) => reviewMatches(candidate, where))) {
                const key = by.map((field) => row[field]).join("|");
                const group = groups.get(key) || { ...Object.fromEntries(by.map((field) => [field, row[field]])), _count: { _all: 0 } };
                group._count._all += 1;
                groups.set(key, group);
            }
            return [...groups.values()];
        }
    },
    auditLog: {
        create: async ({ data }) => {
            audits.push({ ...data });
            return { ...data, timestamp: new Date() };
        }
    }
};
// Catalog code reads product data through other methods; this suite only needs the review paths
// plus the catalog listing, which is served from these minimal product readers.
fakePrisma.product.count = async () => products.filter((row) => !row.isDeleted).length;
fakePrisma.$queryRaw = async (query) => {
    const sql = query.sql || "";
    const live = products.filter((row) => !row.isDeleted).sort((a, b) => a.id - b.id);
    if (sql.includes("COUNT(*) AS total")) return [{ total: live.length }];
    return live.map((row) => ({ id: row.id, min_price: 1000 }));
};
fakePrisma.product.findMany = async ({ where }) => {
    const ids = where.id?.in;
    return products
        .filter((row) => ids ? ids.includes(row.id) : !where.isDeleted || !row.isDeleted)
        .map((row) => ({ ...row, variants: [{ price: 1000, stock: 1 }] }));
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

// ===== Harness =====
let server;
let baseUrl;
const CSRF = "review-csrf";

const tokenFor = (id, role) => jwt.sign(
    { type: "access", ver: 1, role },
    process.env.JWT_ACCESS_SECRET,
    { subject: id, expiresIn: "10m" }
);

const call = (method, path, { as, body, csrf = true } = {}) => {
    const headers = { Origin: process.env.APP_ORIGIN };
    const cookies = [];
    if (as) cookies.push(`__Host-access_token=${tokenFor(as.id, as.role)}`);
    if (csrf) {
        cookies.push(`__Host-csrf_token=${CSRF}`);
        headers["X-CSRF-Token"] = CSRF;
    }
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

const ALICE = { id: "alice", role: "user" };
const BOB = { id: "bob", role: "user" };
const NONAME = { id: "noname", role: "user" };
const ADMIN = { id: "admin-1", role: "admin" };

const deliver = (userId, variantId, status = "DELIVERED") => {
    const id = `order-${orders.length + 1}`;
    orders.push({ id, userId, orderStatus: status });
    orderItems.push({ id: orderItems.length + 1, orderId: id, variantId });
};

const seedReview = (productId, userId, fields = {}) => {
    const row = { id: nextReviewId++, productId, userId, rating: 5, comment: null, isHidden: false, createdAt: ++clock, updatedAt: clock, ...fields };
    reviews.push(row);
    return row;
};

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
    users = [
        { id: "alice", email: "a@x.test", username: "alice_k", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false },
        { id: "bob", email: "b@x.test", username: "bob_k", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false },
        { id: "noname", email: "n@x.test", username: null, role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false },
        { id: "admin-1", email: "ad@x.test", username: "root", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
    ];
    products = [
        { id: 1, name: "Mouse One", isDeleted: false },
        { id: 2, name: "Laptop Two", isDeleted: false },
        { id: 3, name: "Gone", isDeleted: true }
    ];
    variants = [
        { id: 11, productId: 1 },
        { id: 12, productId: 1 },
        { id: 21, productId: 2 },
        { id: 31, productId: 3 }
    ];
    orders = [];
    orderItems = [];
    reviews = [];
    audits = [];
    nextReviewId = 1;
    clock = 1000;
    groupByCalls = [];
});

// ===== Eligibility =====

test("customers without a DELIVERED order for the product cannot review it", async () => {
    const noOrder = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 5 } });
    assert.equal(noOrder.status, 403);
    assert.equal((await noOrder.json()).error.code, "REVIEW_NOT_ELIGIBLE");

    deliver("alice", 11, "PENDING");
    deliver("alice", 11, "SHIPPED");
    deliver("alice", 21, "DELIVERED"); // delivered, but a different product
    const stillNot = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 5 } });
    assert.equal(stillNot.status, 403);
    assert.equal(reviews.length, 0);

    const mine = await (await call("GET", "/api/products/1/reviews/mine", { as: ALICE })).json();
    assert.deepEqual(mine.data, { eligible: false, hasUsername: true, review: null });
});

test("a delivered order of one variant makes the whole product reviewable", async () => {
    deliver("alice", 11);
    const response = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 4 } });
    assert.equal(response.status, 201);
    const mine = await (await call("GET", "/api/products/1/reviews/mine", { as: ALICE })).json();
    assert.equal(mine.data.eligible, true);
    assert.equal(mine.data.review.rating, 4);
    assert.equal(mine.data.review.isHidden, false);
    // another customer's delivered order does not grant eligibility
    const bob = await call("POST", "/api/products/1/reviews", { as: BOB, body: { rating: 4 } });
    assert.equal(bob.status, 403);
});

test("a customer without a username gets USERNAME_REQUIRED once eligible", async () => {
    deliver("noname", 11);
    const response = await call("POST", "/api/products/1/reviews", { as: NONAME, body: { rating: 5 } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "USERNAME_REQUIRED");
    const mine = await (await call("GET", "/api/products/1/reviews/mine", { as: NONAME })).json();
    assert.equal(mine.data.eligible, true);
    assert.equal(mine.data.hasUsername, false);
    assert.equal(reviews.length, 0);
});

test("administrators and anonymous callers cannot write reviews", async () => {
    deliver("admin-1", 11);
    const admin = await call("POST", "/api/products/1/reviews", { as: ADMIN, body: { rating: 5 } });
    assert.equal(admin.status, 403);
    const anonymous = await call("POST", "/api/products/1/reviews", { body: { rating: 5 } });
    assert.equal(anonymous.status, 401);
    const anonymousMine = await call("GET", "/api/products/1/reviews/mine");
    assert.equal(anonymousMine.status, 401);
    const adminMine = await (await call("GET", "/api/products/1/reviews/mine", { as: ADMIN })).json();
    assert.equal(adminMine.data.eligible, false);
    assert.equal(reviews.length, 0);
});

test("review mutations require CSRF", async () => {
    deliver("alice", 11);
    const response = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 5 }, csrf: false });
    assert.equal(response.status, 403);
    assert.equal(reviews.length, 0);
});

test("soft-deleted and unknown products are 404 for every review endpoint", async () => {
    deliver("alice", 31);
    for (const [method, path, body] of [
        ["GET", "/api/products/3/reviews"],
        ["GET", "/api/products/3/reviews/mine"],
        ["POST", "/api/products/3/reviews", { rating: 5 }],
        ["GET", "/api/products/999/reviews"],
        ["GET", "/api/products/abc/reviews"]
    ]) {
        const response = await call(method, path, { as: ALICE, body });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal((await response.json()).error.code, "PRODUCT_NOT_FOUND");
    }
});

// ===== Creation rules =====

test("one review per product per user, even when raced or hidden", async () => {
    deliver("alice", 11);
    const [first, second] = await Promise.all([
        call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 5 } }),
        call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 1 } })
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    const loser = first.status === 409 ? first : second;
    assert.equal((await loser.json()).error.code, "REVIEW_EXISTS");
    assert.equal(reviews.length, 1);

    reviews[0].isHidden = true;
    const again = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 3 } });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, "REVIEW_EXISTS");
});

test("rating-only and comment-only reviews are accepted; empty ones are rejected", async () => {
    deliver("alice", 11);
    deliver("bob", 11);
    const ratingOnly = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 3 } });
    assert.equal(ratingOnly.status, 201);
    const commentOnly = await call("POST", "/api/products/1/reviews", { as: BOB, body: { comment: "  Tốt  " } });
    assert.equal(commentOnly.status, 201);
    assert.equal((await commentOnly.json()).data.comment, "Tốt");
    assert.equal(reviews.find((row) => row.userId === "bob").rating, null);

    users.push({ id: "carol", email: "c@x.test", username: "carol", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false });
    deliver("carol", 11);
    for (const body of [{}, { comment: "" }, { comment: "   " }, { rating: null, comment: null }]) {
        const response = await call("POST", "/api/products/1/reviews", { as: { id: "carol", role: "user" }, body });
        assert.equal(response.status, 422, JSON.stringify(body));
        assert.equal((await response.json()).error.code, "VALIDATION_FAILED");
    }
    assert.equal(reviews.length, 2);
});

test("comment limit is 1000 characters and rating must be an integer 1-5", async () => {
    deliver("alice", 11);
    const tooLong = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { comment: "a".repeat(1001) } });
    assert.equal(tooLong.status, 422);
    assert.equal((await tooLong.json()).error.errors[0].field, "comment");

    for (const rating of [0, 6, 1.5, "5", -1, true]) {
        const response = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating } });
        assert.equal(response.status, 422, `rating ${JSON.stringify(rating)}`);
        assert.equal((await response.json()).error.errors[0].field, "rating");
    }
    assert.equal(reviews.length, 0);

    const exactly = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { comment: "a".repeat(1000) } });
    assert.equal(exactly.status, 201);
    assert.equal(reviews[0].comment.length, 1000);
});

// ===== Own review: edit and delete =====

test("editing keeps a hidden review hidden; delete removes the row", async () => {
    deliver("alice", 11);
    seedReview(1, "alice", { rating: 2, isHidden: true });
    const edit = await call("PUT", "/api/products/1/reviews/mine", { as: ALICE, body: { rating: 4, comment: "Cập nhật" } });
    assert.equal(edit.status, 200);
    const edited = (await edit.json()).data;
    assert.equal(edited.rating, 4);
    assert.equal(edited.comment, "Cập nhật");
    assert.equal(edited.isHidden, true);
    assert.equal(reviews[0].isHidden, true);

    const invalid = await call("PUT", "/api/products/1/reviews/mine", { as: ALICE, body: { comment: " " } });
    assert.equal(invalid.status, 422);

    const removed = await call("DELETE", "/api/products/1/reviews/mine", { as: ALICE });
    assert.equal(removed.status, 200);
    assert.equal(reviews.length, 0);
    const missing = await call("DELETE", "/api/products/1/reviews/mine", { as: ALICE });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "REVIEW_NOT_FOUND");
    const missingEdit = await call("PUT", "/api/products/1/reviews/mine", { as: ALICE, body: { rating: 5 } });
    assert.equal(missingEdit.status, 404);
});

test("a customer cannot touch another customer's review", async () => {
    seedReview(1, "alice", { rating: 5 });
    const response = await call("DELETE", "/api/products/1/reviews/mine", { as: BOB });
    assert.equal(response.status, 404);
    assert.equal(reviews.length, 1);
});

// ===== Public list and summary =====

test("hidden reviews leave the list, average and count; comment-only reviews show but are not rated", async () => {
    seedReview(1, "alice", { rating: 5, comment: "Rất tốt" });
    seedReview(1, "bob", { rating: 2, isHidden: true, comment: "Ẩn" });
    seedReview(1, "noname", { rating: null, comment: "Chỉ nhận xét" });
    users.push({ id: "dave", email: "d@x.test", username: "dave", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false });
    seedReview(1, "dave", { rating: 4 });

    const body = await (await call("GET", "/api/products/1/reviews")).json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data.map((row) => row.username), ["dave", "Khach hang", "alice_k"]);
    assert.deepEqual(body.summary, {
        ratingAverage: 4.5,
        ratingCount: 2,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
        commentCount: 2
    });
    assert.deepEqual(body.meta, { page: 1, pageSize: 5, total: 3, totalPages: 1 });
    for (const row of body.data) assert.deepEqual(Object.keys(row).sort(), ["comment", "createdAt", "id", "rating", "updatedAt", "username"]);
    assert.equal(JSON.stringify(body).includes("@x.test"), false);

    const empty = await (await call("GET", "/api/products/2/reviews")).json();
    assert.equal(empty.summary.ratingAverage, null);
    assert.equal(empty.summary.ratingCount, 0);
    assert.deepEqual(empty.data, []);
});

test("average is rounded to one decimal", async () => {
    for (const [index, rating] of [5, 4, 4].entries()) {
        users.push({ id: `u${index}`, email: null, username: `u${index}`, role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false });
        seedReview(1, `u${index}`, { rating });
    }
    const body = await (await call("GET", "/api/products/1/reviews")).json();
    assert.equal(body.summary.ratingAverage, 4.3); // 13 / 3 = 4.333...
});

test("review pagination defaults, bounds and clamping", async () => {
    for (let index = 0; index < 7; index++) {
        users.push({ id: `p${index}`, email: null, username: `p${index}`, role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false });
        seedReview(1, `p${index}`, { rating: 5, comment: `c${index}` });
    }
    const first = await (await call("GET", "/api/products/1/reviews")).json();
    assert.equal(first.data.length, 5);
    assert.deepEqual(first.data.map((row) => row.comment), ["c6", "c5", "c4", "c3", "c2"]); // newest first
    assert.deepEqual(first.meta, { page: 1, pageSize: 5, total: 7, totalPages: 2 });

    const second = await (await call("GET", "/api/products/1/reviews?page=2")).json();
    assert.deepEqual(second.data.map((row) => row.comment), ["c1", "c0"]);

    const beyond = await (await call("GET", "/api/products/1/reviews?page=99")).json();
    assert.equal(beyond.meta.page, 2);
    assert.equal(beyond.data.length, 2);

    assert.equal((await call("GET", "/api/products/1/reviews?pageSize=20")).status, 200);
    for (const query of ["pageSize=21", "pageSize=0", "page=0", "page=-1", "page=x", "pageSize=1.5"]) {
        const response = await call("GET", `/api/products/1/reviews?${query}`);
        assert.equal(response.status, 400, query);
        assert.equal((await response.json()).error.code, "INVALID_PAGINATION");
    }
});

// ===== Admin moderation =====

test("administrators hide and unhide reviews with an audit entry; customers cannot", async () => {
    seedReview(1, "alice", { rating: 5, comment: "Tốt" });
    const hide = await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: true } });
    assert.equal(hide.status, 200);
    assert.equal((await hide.json()).data.isHidden, true);
    assert.equal(reviews.length, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entity, "review");
    assert.equal(audits[0].entityId, "1");
    assert.equal(audits[0].actor, "admin-1");
    assert.deepEqual(JSON.parse(audits[0].changesJson), { isHidden: { old: false, new: true } });

    const publicList = await (await call("GET", "/api/products/1/reviews")).json();
    assert.equal(publicList.summary.ratingCount, 0);
    assert.equal(publicList.data.length, 0);

    const unhide = await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: false } });
    assert.equal(unhide.status, 200);
    assert.equal(audits.length, 2);

    assert.equal((await call("PATCH", "/api/admin/reviews/1", { as: ALICE, body: { isHidden: true } })).status, 403);
    assert.equal((await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: "yes" } })).status, 422);
    assert.equal((await call("PATCH", "/api/admin/reviews/77", { as: ADMIN, body: { isHidden: true } })).status, 404);
    assert.equal((await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: true }, csrf: false })).status, 403);
    assert.equal(audits.length, 2);
});

test("admin review list filters by product, visibility and text", async () => {
    seedReview(1, "alice", { rating: 5, comment: "Great mouse" });
    seedReview(1, "bob", { rating: 1, isHidden: true, comment: "Broken" });
    seedReview(2, "alice", { rating: 3 });

    const all = await (await call("GET", "/api/admin/reviews", { as: ADMIN })).json();
    assert.equal(all.meta.total, 3);
    assert.deepEqual(all.data.map((row) => row.id), [3, 2, 1]);
    assert.deepEqual(Object.keys(all.data[0]).sort(), [
        "comment", "createdAt", "id", "isHidden", "productId", "productName", "rating", "updatedAt", "username"
    ]);
    assert.equal(all.data[0].productName, "Laptop Two");

    const hidden = await (await call("GET", "/api/admin/reviews?hidden=hidden", { as: ADMIN })).json();
    assert.deepEqual(hidden.data.map((row) => row.id), [2]);
    const visibleOfProduct = await (await call("GET", "/api/admin/reviews?hidden=visible&productId=1", { as: ADMIN })).json();
    assert.deepEqual(visibleOfProduct.data.map((row) => row.id), [1]);
    const searched = await (await call("GET", "/api/admin/reviews?q=broken", { as: ADMIN })).json();
    assert.deepEqual(searched.data.map((row) => row.id), [2]);

    assert.equal((await call("GET", "/api/admin/reviews?hidden=nope", { as: ADMIN })).status, 400);
    assert.equal((await call("GET", "/api/admin/reviews?productId=x", { as: ADMIN })).status, 400);
    assert.equal((await call("GET", "/api/admin/reviews", { as: ALICE })).status, 403);
    assert.equal((await call("GET", "/api/admin/reviews")).status, 401);
});

// ===== Aggregates in product responses =====

test("product list carries rating aggregates from one grouped query per page", async () => {
    seedReview(1, "alice", { rating: 5 });
    seedReview(1, "bob", { rating: 4 });
    seedReview(1, "noname", { rating: 1, isHidden: true });
    seedReview(2, "alice", { rating: null, comment: "Chỉ chữ" });

    groupByCalls = [];
    const list = await (await call("GET", "/api/products")).json();
    assert.equal(groupByCalls.length, 1);
    assert.deepEqual(groupByCalls[0].where.productId.in.sort(), [1, 2]);
    const byId = new Map(list.data.map((product) => [product.id, product]));
    assert.equal(byId.get(1).ratingAverage, 4.5);
    assert.equal(byId.get(1).ratingCount, 2);
    assert.equal(byId.get(2).ratingAverage, null);
    assert.equal(byId.get(2).ratingCount, 0);
});
