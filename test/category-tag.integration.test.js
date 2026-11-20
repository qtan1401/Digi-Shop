const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const { createCategoryTagFake } = require("../test-support/category-tag-fake");
const { BRANDS, DEVICE_TYPES, DEVICE_TYPE_LABELS, brandSlug } = require("../public/js/catalog-taxonomy");

let fake;
const db = require("../src/db/prisma");
db.getPrismaClient = () => fake.prisma;
const categoryService = require("../src/services/category.service");
const tagService = require("../src/services/tag.service");

const rejectsWith = (promise, code, statusCode) => assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    if (statusCode) assert.equal(error.statusCode, statusCode);
    assert.ok(error.message && /[^\x00-\x7F]|\s/.test(error.message), "message is a human sentence");
    return true;
});

// The six live categories as the migration seeds them.
const seedCategories = async () => {
    for (const slug of DEVICE_TYPES) await categoryService.createCategory({ slug, name: DEVICE_TYPE_LABELS[slug] });
};

beforeEach(() => {
    fake = createCategoryTagFake();
});

test("public category list shows only undeleted categories in sort order", async () => {
    await categoryService.createCategory({ name: "Loa", slug: "speaker", sortOrder: 20 });
    await categoryService.createCategory({ name: "Webcam", slug: "webcam", sortOrder: 5 });
    const hidden = await categoryService.createCategory({ name: "Điện thoại", slug: "phone", sortOrder: 1 });
    await categoryService.softDeleteCategory(hidden.id);

    const list = await categoryService.listCategories();
    assert.deepEqual(list.map((category) => category.slug), ["webcam", "speaker"]);
    assert.deepEqual(Object.keys(list[0]).sort(), ["id", "name", "slug", "sortOrder"]);
});

test("creating a category validates and normalizes the slug and name", async () => {
    const created = await categoryService.createCategory({ name: "  Bàn   phím  cơ ", slug: "  Ban-Phim-Co " });
    assert.equal(created.slug, "ban-phim-co");
    assert.equal(created.name, "Bàn phím cơ");
    assert.equal(created.isDeleted, false);

    const derived = await categoryService.createCategory({ name: "Đế tản nhiệt laptop" });
    assert.equal(derived.slug, "de-tan-nhiet-laptop");

    for (const slug of ["a", "x".repeat(41), "co dau cach", "Hai_Gach", "a/b"]) {
        await rejectsWith(categoryService.createCategory({ name: "Hợp lệ", slug }), "VALIDATION_FAILED", 400);
    }
    await rejectsWith(categoryService.createCategory({ name: "   ", slug: "ten-trong" }), "VALIDATION_FAILED", 400);
    await rejectsWith(categoryService.createCategory({ name: "x".repeat(81), slug: "ten-dai" }), "VALIDATION_FAILED", 400);
    await rejectsWith(categoryService.createCategory({ name: "Thứ tự", slug: "thu-tu", sortOrder: -1 }), "VALIDATION_FAILED", 400);
    await rejectsWith(categoryService.createCategory({ name: "Thứ tự", slug: "thu-tu", sortOrder: 1.5 }), "VALIDATION_FAILED", 400);
});

test("a new category without sortOrder goes to the end", async () => {
    await seedCategories();
    const created = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    assert.equal(created.sortOrder, 7);
});

test("category slugs are unique among undeleted rows, and a deleted slug can be reused", async () => {
    const first = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    await rejectsWith(categoryService.createCategory({ name: "Loa khác", slug: "SPEAKER" }), "SLUG_TAKEN", 409);

    await categoryService.softDeleteCategory(first.id);
    const reused = await categoryService.createCategory({ name: "Loa mới", slug: "speaker" });
    assert.notEqual(reused.id, first.id);
    assert.equal((await categoryService.getCategoryBySlug("speaker")).id, reused.id);
    assert.equal((await categoryService.getCategory(first.id)).isDeleted, true);
});

test("a concurrent duplicate slug that slips past the pre-check maps to SLUG_TAKEN", async () => {
    const repository = require("../src/repositories/category.repository");
    const create = fake.prisma.category.create;
    let raced = false;
    fake.prisma.category.create = async (args) => {
        if (!raced) {
            raced = true;
            await create({ data: { slug: "speaker", name: "Loa của request khác" } });
        }
        return create(args);
    };
    await rejectsWith(categoryService.createCategory({ name: "Loa", slug: "speaker" }), "SLUG_TAKEN", 409);
    assert.equal((await repository.listActive()).length, 1);
});

test("updating a category renames and reorders freely, even with products", async () => {
    const { id } = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    fake.addProduct({ categoryId: id });

    const updated = await categoryService.updateCategory(id, { name: "Loa máy tính", sortOrder: "42" });
    assert.equal(updated.name, "Loa máy tính");
    assert.equal(updated.sortOrder, 42);
    assert.equal(updated.slug, "speaker");

    const same = await categoryService.updateCategory(String(id), { slug: "speaker" });
    assert.equal(same.slug, "speaker");
    assert.deepEqual(await categoryService.updateCategory(id, {}), same);
});

test("a category slug can change only while no product, deleted or not, belongs to it", async () => {
    const empty = await categoryService.createCategory({ name: "Trống", slug: "trong" });
    assert.equal((await categoryService.updateCategory(empty.id, { slug: "Rong" })).slug, "rong");

    const used = await categoryService.createCategory({ name: "Đang dùng", slug: "dang-dung" });
    fake.addProduct({ categoryId: used.id });
    await rejectsWith(categoryService.updateCategory(used.id, { slug: "doi-slug" }), "CATEGORY_SLUG_LOCKED", 409);

    const onlyDeleted = await categoryService.createCategory({ name: "Chỉ có hàng xóa", slug: "hang-xoa" });
    fake.addProduct({ categoryId: onlyDeleted.id, isDeleted: true });
    await rejectsWith(categoryService.updateCategory(onlyDeleted.id, { slug: "doi-slug" }), "CATEGORY_SLUG_LOCKED", 409);

    assert.equal((await categoryService.getCategory(used.id)).slug, "dang-dung");
    assert.equal((await categoryService.getCategory(onlyDeleted.id)).slug, "hang-xoa");
});

test("changing a category slug onto another undeleted category's slug is SLUG_TAKEN", async () => {
    await categoryService.createCategory({ name: "Một", slug: "mot" });
    const two = await categoryService.createCategory({ name: "Hai", slug: "hai" });
    await rejectsWith(categoryService.updateCategory(two.id, { slug: "mot" }), "SLUG_TAKEN", 409);
    assert.equal((await categoryService.getCategory(two.id)).slug, "hai");
});

test("updating validates input and refuses unknown or deleted categories", async () => {
    const { id } = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    await rejectsWith(categoryService.updateCategory(id, { slug: "X" }), "VALIDATION_FAILED", 400);
    await rejectsWith(categoryService.updateCategory(id, { name: "" }), "VALIDATION_FAILED", 400);
    await rejectsWith(categoryService.updateCategory(999, { name: "Không có" }), "CATEGORY_NOT_FOUND", 404);
    await rejectsWith(categoryService.updateCategory("abc", { name: "Không có" }), "CATEGORY_NOT_FOUND", 404);

    await categoryService.softDeleteCategory(id);
    await rejectsWith(categoryService.updateCategory(id, { name: "Đã xóa" }), "CATEGORY_NOT_FOUND", 404);
});

test("soft delete is refused while undeleted products belong to the category", async () => {
    const { id } = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    const productId = fake.addProduct({ categoryId: id });
    await assert.rejects(categoryService.softDeleteCategory(id), (error) => {
        assert.equal(error.code, "CATEGORY_IN_USE");
        assert.equal(error.statusCode, 409);
        assert.equal(error.details.productCount, 1);
        assert.match(error.message, /Loa/);
        return true;
    });
    assert.equal((await categoryService.getCategory(id)).isDeleted, false);
    assert.equal((await categoryService.listAdminCategories())[0].productCount, 1);

    // Once the only product is soft-deleted the category can go, and the product keeps pointing at it.
    fake.state.products.find((product) => product.id === productId).isDeleted = true;
    const deleted = await categoryService.softDeleteCategory(id);
    assert.equal(deleted.isDeleted, true);
    assert.equal(fake.state.products[0].categoryId, id);
    assert.deepEqual(await categoryService.listCategories(), []);
    await rejectsWith(categoryService.softDeleteCategory(id), "CATEGORY_NOT_FOUND", 404);
});

test("admin category list can include deleted rows and counts undeleted products", async () => {
    const live = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    const gone = await categoryService.createCategory({ name: "Cũ", slug: "cu" });
    await categoryService.softDeleteCategory(gone.id);
    fake.addProduct({ categoryId: live.id });
    fake.addProduct({ categoryId: live.id, isDeleted: true });

    const active = await categoryService.listAdminCategories();
    assert.deepEqual(active.map((category) => [category.slug, category.productCount]), [["speaker", 1]]);
    const everything = await categoryService.listAdminCategories({ includeDeleted: true });
    assert.deepEqual(everything.map((category) => category.slug), ["speaker", "cu"]);
});

test("category lookup by slug only finds undeleted categories", async () => {
    const { id } = await categoryService.createCategory({ name: "Loa", slug: "speaker" });
    assert.equal((await categoryService.getCategoryBySlug("Speaker")).id, id);
    await rejectsWith(categoryService.getCategoryBySlug("missing"), "CATEGORY_NOT_FOUND", 404);
    await categoryService.softDeleteCategory(id);
    await rejectsWith(categoryService.getCategoryBySlug("speaker"), "CATEGORY_NOT_FOUND", 404);
});

test("tags: create, list, rename and slug rules", async () => {
    const gaming = await tagService.createTag({ name: "Gaming", slug: "gaming" });
    const wireless = await tagService.createTag({ name: "Không dây" });
    assert.equal(wireless.slug, "khong-day");
    await rejectsWith(tagService.createTag({ name: "Gaming 2", slug: "GAMING" }), "SLUG_TAKEN", 409);
    await rejectsWith(tagService.createTag({ name: "Tên", slug: "a" }), "VALIDATION_FAILED", 400);
    await rejectsWith(tagService.createTag({ name: "", slug: "ten-trong" }), "VALIDATION_FAILED", 400);
    await rejectsWith(tagService.createTag({ name: "x".repeat(61), slug: "ten-dai" }), "VALIDATION_FAILED", 400);

    assert.deepEqual((await tagService.listTags()).map((tag) => tag.slug), ["gaming", "khong-day"]);
    const renamed = await tagService.updateTag(gaming.id, { name: "Chơi game", slug: "choi-game" });
    assert.equal(renamed.slug, "choi-game");
    assert.equal((await tagService.getTagBySlug("choi-game")).id, gaming.id);
    await rejectsWith(tagService.getTagBySlug("gaming"), "TAG_NOT_FOUND", 404);
    await rejectsWith(tagService.updateTag(wireless.id, { slug: "choi-game" }), "SLUG_TAKEN", 409);
    await rejectsWith(tagService.updateTag(404, { name: "Không có" }), "TAG_NOT_FOUND", 404);
});

test("a tag may not take a brand slug, because /the/<brand> redirects to /hang/<brand>", async () => {
    assert.deepEqual([...tagService.RESERVED_SLUGS].sort(), BRANDS.map(brandSlug).sort());
    for (const slug of tagService.RESERVED_SLUGS) {
        await assert.rejects(tagService.createTag({ name: "Hãng", slug }), (error) => {
            assert.equal(error.code, "TAG_SLUG_RESERVED");
            assert.equal(error.statusCode, 409);
            return true;
        });
    }
    await rejectsWith(tagService.createTag({ name: "Razer" }), "TAG_SLUG_RESERVED", 409);
    const { id } = await tagService.createTag({ name: "Gaming", slug: "gaming" });
    await rejectsWith(tagService.updateTag(id, { slug: "Apple" }), "TAG_SLUG_RESERVED", 409);
    assert.equal((await tagService.getTag(id)).slug, "gaming");
    assert.equal((await tagService.listTags()).length, 1);
});

test("deleting a tag soft-deletes it, drops it from products and frees its slug", async () => {
    const productId = fake.addProduct({ categoryId: 1 });
    const gaming = await tagService.createTag({ name: "Gaming", slug: "gaming" });
    const rgb = await tagService.createTag({ name: "RGB", slug: "rgb" });
    await tagService.setProductTags(productId, [gaming.id, rgb.id]);
    assert.equal((await tagService.listAdminTags())[0].productCount, 1);

    const deleted = await tagService.softDeleteTag(gaming.id);
    assert.equal(deleted.isDeleted, true);
    assert.deepEqual((await tagService.getProductTags(productId)).map((tag) => tag.slug), ["rgb"]);
    assert.deepEqual((await tagService.listTags()).map((tag) => tag.slug), ["rgb"]);
    await rejectsWith(tagService.softDeleteTag(gaming.id), "TAG_NOT_FOUND", 404);
    await rejectsWith(tagService.updateTag(gaming.id, { name: "Đã xóa" }), "TAG_NOT_FOUND", 404);
    await rejectsWith(tagService.setProductTags(productId, [gaming.id]), "VALIDATION_FAILED", 400);

    const reused = await tagService.createTag({ name: "Gaming mới", slug: "gaming" });
    assert.notEqual(reused.id, gaming.id);
    assert.equal((await tagService.listAdminTags({ includeDeleted: true })).length, 3);
});

test("setProductTags replaces the whole set, dedupes and can clear it", async () => {
    const productId = fake.addProduct({ categoryId: 1 });
    const other = fake.addProduct({ categoryId: 1 });
    const a = await tagService.createTag({ name: "Văn phòng", slug: "van-phong" });
    const b = await tagService.createTag({ name: "Gaming", slug: "gaming" });
    const c = await tagService.createTag({ name: "RGB", slug: "rgb" });

    assert.deepEqual((await tagService.setProductTags(productId, [a.id, b.id, a.id])).map((tag) => tag.slug), ["gaming", "van-phong"]);
    await tagService.setProductTags(other, [a.id]);
    assert.deepEqual((await tagService.setProductTags(productId, [`${c.id}`])).map((tag) => tag.slug), ["rgb"]);
    assert.deepEqual((await tagService.getProductTags(other)).map((tag) => tag.slug), ["van-phong"]);

    const byProduct = await tagService.getTagsByProductIds([productId, other, 999]);
    assert.deepEqual([...byProduct.keys()].sort(), [productId, other].sort());
    assert.deepEqual(byProduct.get(productId).map((tag) => tag.slug), ["rgb"]);

    assert.deepEqual(await tagService.setProductTags(productId, []), []);
    assert.deepEqual(await tagService.getProductTags(productId), []);
    assert.equal(fake.state.productTags.length, 1);
});

test("setProductTags rejects bad input without touching existing links", async () => {
    const productId = fake.addProduct({ categoryId: 1 });
    const gaming = await tagService.createTag({ name: "Gaming", slug: "gaming" });
    await tagService.setProductTags(productId, [gaming.id]);

    await assert.rejects(tagService.setProductTags(productId, [gaming.id, 9999]), (error) => {
        assert.equal(error.code, "VALIDATION_FAILED");
        assert.deepEqual(error.details.missingTagIds, [9999]);
        return true;
    });
    await rejectsWith(tagService.setProductTags(productId, "gaming"), "VALIDATION_FAILED", 400);
    await rejectsWith(tagService.setProductTags(productId, [0]), "VALIDATION_FAILED", 400);
    await rejectsWith(tagService.setProductTags(productId, Array.from({ length: tagService.MAX_TAGS_PER_PRODUCT + 1 }, (_, index) => index + 1)), "VALIDATION_FAILED", 400);
    await rejectsWith(tagService.setProductTags(404, [gaming.id]), "PRODUCT_NOT_FOUND", 404);
    await rejectsWith(tagService.getProductTags(404), "PRODUCT_NOT_FOUND", 404);
    assert.deepEqual((await tagService.getProductTags(productId)).map((tag) => tag.id), [gaming.id]);
});
