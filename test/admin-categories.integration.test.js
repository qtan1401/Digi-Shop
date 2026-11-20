const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { startAdminApp } = require("../test-support/admin-harness");
const { createCategoryTagFake } = require("../test-support/category-tag-fake");

const state = { users: [], orders: [], orderItems: [], variants: [], products: [], refreshSessions: [], auditLogs: [], calls: [] };
const harness = startAdminApp(state);
const prisma = require("../src/db/prisma").getPrismaClient();
const ADMIN = ["root", "admin"];
let taxonomy;

before(() => harness.start());
after(() => harness.stop());
beforeEach(() => {
    taxonomy = createCategoryTagFake();
    Object.assign(prisma, {
        category: taxonomy.prisma.category,
        tag: taxonomy.prisma.tag,
        productTag: taxonomy.prisma.productTag,
        product: taxonomy.prisma.product,
        $queryRaw: taxonomy.prisma.$queryRaw,
        $transaction: taxonomy.prisma.$transaction
    });
    state.users = [
        { id: "root", role: "admin", status: "ACTIVE", authVersion: 1 },
        { id: "customer", role: "user", status: "ACTIVE", authVersion: 1 }
    ];
    state.auditLogs = [];
});

const request = (method, url, body, options = {}) =>
    harness.json(method, `/api/admin/${url}`, { as: ADMIN, body, ...options });

const audit = () => state.auditLogs.map(({ actor, action, entity, entityId }) =>
    [actor, action, entity, entityId]);

test("only administrators can list or mutate categories and tags", async () => {
    for (const resource of ["categories", "tags"]) {
        assert.equal((await harness.json("GET", `/api/admin/${resource}`)).status, 401);
        assert.equal((await harness.json("GET", `/api/admin/${resource}`, { as: ["customer", "user"] })).status, 403);
        assert.equal((await harness.json("POST", `/api/admin/${resource}`, { as: ["customer", "user"], body: { name: "Gaming" } })).status, 403);
        assert.equal((await harness.json("PATCH", `/api/admin/${resource}/1`, { as: ["customer", "user"], body: { name: "Khác" } })).status, 403);
        assert.equal((await harness.json("DELETE", `/api/admin/${resource}/1`, { as: ["customer", "user"] })).status, 403);
    }
    assert.equal(state.auditLogs.length, 0);
});

test("all category and tag writes require CSRF", async () => {
    for (const resource of ["categories", "tags"]) {
        const created = await request("POST", resource, { name: "Gaming" });
        assert.equal(created.status, 201);
        const id = created.body.data.id;
        for (const [method, path, body] of [
            ["POST", resource, { name: "Khác" }],
            ["PATCH", `${resource}/${id}`, { name: "Khác" }],
            ["DELETE", `${resource}/${id}`]
        ]) {
            assert.equal((await request(method, path, body, { csrf: false })).status, 403);
        }
        assert.equal((await request("GET", resource)).body.data[0].name, "Gaming");
    }
    assert.equal(state.auditLogs.length, 2);
});

test("categories list active rows with undeleted product counts; CRUD logs snapshots", async () => {
    const created = await request("POST", "categories", { name: "  Bàn phím  ", slug: "keyboard", sortOrder: 3 });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.name, "Bàn phím");
    const id = created.body.data.id;
    taxonomy.addProduct({ categoryId: id });
    taxonomy.addProduct({ categoryId: id, isDeleted: true });
    const listed = await request("GET", "categories");
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.map(({ id: itemId, slug, name, sortOrder, productCount }) =>
        ({ id: itemId, slug, name, sortOrder, productCount })),
    [{ id, slug: "keyboard", name: "Bàn phím", sortOrder: 3, productCount: 1 }]);
    const renamed = await request("PATCH", `categories/${id}`, { name: "Bàn phím cơ", sortOrder: 5 });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.sortOrder, 5);
    assert.equal(renamed.body.data.name, "Bàn phím cơ");
    assert.deepEqual(audit(), [
        ["root", "CREATE", "category", String(id)],
        ["root", "UPDATE", "category", String(id)]
    ]);
    assert.equal(JSON.parse(state.auditLogs[1].changesJson).name.old, "Bàn phím");
    assert.equal(JSON.parse(state.auditLogs[1].changesJson).name.new, "Bàn phím cơ");
});

test("duplicate slugs, in-use category deletion and locked slug preserve data without audits", async () => {
    const created = await request("POST", "categories", { name: "Chuột", slug: "mouse" });
    const id = created.body.data.id;
    taxonomy.addProduct({ categoryId: id });
    const duplicate = await request("POST", "categories", { name: "Chuột khác", slug: "mouse" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "SLUG_TAKEN");
    assert.ok(duplicate.body.error.message.includes("Slug"));
    const locked = await request("PATCH", `categories/${id}`, { slug: "new-mouse" });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, "CATEGORY_SLUG_LOCKED");
    const inUse = await request("DELETE", `categories/${id}`);
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.error.code, "CATEGORY_IN_USE");
    assert.equal(inUse.body.error.details.productCount, 1);
    assert.equal(audit().length, 1);
    assert.equal((await request("GET", "categories")).body.data[0].slug, "mouse");
});

test("a category with no live products can be soft-deleted, audited and its slug reused", async () => {
    const original = (await request("POST", "categories", { name: "Lưu trữ", slug: "storage" })).body.data;
    taxonomy.addProduct({ categoryId: original.id, isDeleted: true });
    const removed = await request("DELETE", `categories/${original.id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.isDeleted, true);
    assert.deepEqual((await request("GET", "categories")).body.data, []);
    assert.equal((await request("POST", "categories", { name: "Lưu trữ mới", slug: "storage" })).status, 201);
    assert.deepEqual(audit().map((entry) => entry[1]), ["CREATE", "DELETE", "CREATE"]);
});

test("tags support create, rename, list counts, soft delete and duplicate slug errors", async () => {
    const created = await request("POST", "tags", { name: "Gaming", slug: "gaming" });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    const duplicate = await request("POST", "tags", { name: "Gaming khác", slug: "gaming" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "SLUG_TAKEN");
    const productId = taxonomy.addProduct({ categoryId: 1 });
    taxonomy.state.productTags.push({ tagId: id, productId });
    const listed = await request("GET", "tags");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data[0].productCount, 1);
    const updated = await request("PATCH", `tags/${id}`, { name: "Chơi game", slug: "choi-game" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.slug, "choi-game");
    const removed = await request("DELETE", `tags/${id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.isDeleted, true);
    assert.deepEqual((await request("GET", "tags")).body.data, []);
    assert.deepEqual(taxonomy.state.productTags, []);
    assert.deepEqual(audit(), [
        ["root", "CREATE", "tag", String(id)],
        ["root", "UPDATE", "tag", String(id)],
        ["root", "DELETE", "tag", String(id)]
    ]);
});

test("invalid identifiers and invalid fields return safe Vietnamese errors without audit", async () => {
    for (const resource of ["categories", "tags"]) {
        const invalid = await request("POST", resource, { name: "" });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.body.error.code, "VALIDATION_FAILED");
        assert.ok(invalid.body.error.details.fields.name);
        const missing = await request("DELETE", `${resource}/xyz`);
        assert.equal(missing.status, 404);
        assert.match(missing.body.error.message, /Không tìm thấy/);
    }
    assert.equal(state.auditLogs.length, 0);
});
