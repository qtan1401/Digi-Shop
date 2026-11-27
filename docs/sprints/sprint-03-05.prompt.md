# Sprint 3, 4, 5: prompt cho agent chính (Digi-Shop)

> **Đã thay thế một phần.** Prompt điều phối chính giờ là `docs/sprints/postgres-s3-s5-deploy.prompt.md`
> (chuyển sang PostgreSQL trước, rồi Sprint 3, 4, 5, rồi deploy). File đó dùng lại **mục 2 (Sprint 3)** và
> **mục 3 (Sprint 4)** dưới đây kèm các điều chỉnh cho PostgreSQL. **Mục 4 (Sprint 5, Redis + Docker) không còn dùng.**

> File này là **prompt điều phối**, cùng khuôn với `docs/sprints/sprint-01-02.prompt.md`. Agent chính đọc toàn bộ,
> chia việc, giao từng việc nhỏ cho **subagent**, rồi tự **review, chạy test, kiểm tra trên trình duyệt**.
> Cuối cùng **chỉ đề xuất** commit (không tự commit, không push). Người dùng xem và quyết định.
>
> Ba sprint chạy **lần lượt** (3 → 4 → 5), mỗi sprint kết thúc bằng một lần review + đề xuất commit riêng rồi
> **dừng lại chờ người dùng duyệt** trước khi sang sprint sau.

---

## 0. Bối cảnh bắt buộc phải đọc trước

- Repo: `A:\Digi-Shop`, nhánh gốc `master` (HEAD `9575e02`). Stack: Node.js/Express (CommonJS, 4 spaces), Prisma 7.10.0
  + SQL Server (`@prisma/adapter-mssql`), frontend HTML/JS thuần (`public/`), test `node --test` (`npm test`, mốc hiện
  tại **359 pass / 0 fail**, phải giữ hoặc tăng).
- Đề bài: `A:\NodeJS Final Project.pdf`. Các mục liên quan:
  - **Pagination** (trang 3): *"When presenting a demonstration, if the website lacks sufficient data to showcase the
    pagination feature, it will be considered as not having this functionality."* Catalog dùng `pageSize = 12`
    (`src/services/product.service.js` ~366), nên **mỗi trang danh mục cần > 12 sản phẩm** mới thấy trang 2.
  - **Product catalog**: *"Organizes products into categories and tags to improve navigation and SEO."*
  - **Admin / Product Management**: *"Admins can add, update, or delete products, **manage categories**, and handle
    inventory."* (rubric #25).
  - **Advanced Dashboard** (rubric #28, 0.5đ): mặc định theo năm, đổi được sang quý, tháng, tuần hoặc khoảng tự chọn.
    Cần dữ liệu trải **nhiều năm** để thấy so sánh.
  - **Horizontal Scaling** (rubric #35, 0.5đ): *"stateless architecture, load balancing ... You can implement this on a
    public hosting service of your choice or using **Docker Compose** ... you must provide clear evidence."*
- Đọc `AGENTS.md`, `GLOSSARY.md`, `docs/agents/domain.md` để dùng đúng thuật ngữ.
- Quy ước commit: Conventional Commits, tiếng Anh, chữ thường sau `:`, có scope (`feat(catalog): ...`,
  `fix(shop): ...`, `chore(seed): ...`). Dòng cuối mỗi message: `Co-Authored-By: Claude <noreply@anthropic.com>`.

### Ràng buộc an toàn (agent chính VÀ mọi subagent)

1. Mỗi sprint một nhánh tạo từ `master` mới nhất: `sprint/03-categories-catalog-data`, `sprint/04-demo-data-dashboard`,
   `sprint/05-horizontal-scaling`. Không push, không merge, **không commit** (chỉ đề xuất).
2. **Không** sửa `.env`, không in giá trị bí mật. Biến mới chỉ thêm vào `.env.example` với giá trị mẫu.
   **Không** stage `package-lock.json` trừ khi sprint đó thật sự thêm dependency (Sprint 5), và khi đó báo rõ.
   Không chạy `npm audit fix`.
3. Migration **chỉ thêm mới** (append-only) trong `prisma/migrations/`, không sửa migration cũ. Mỗi migration phải chạy
   được trên DB đang có dữ liệu (backfill trước, ràng buộc sau).
4. Không đụng auth, MoMo/VNPay, voucher, điểm thưởng ngoài phạm vi ghi rõ.
5. Server dev của người dùng chạy ở cổng **3000**: không kill. Cần chạy app thì dùng `PORT=3100`
   (PowerShell: `$env:PORT=3100; npm start`), tắt khi xong. Lệnh PowerShell 5.1: không dùng `&&`, dùng `;`.
6. Chỉ sản phẩm **máy tính và linh kiện/phụ kiện máy tính**. Tuyệt đối không thêm điện thoại, máy tính bảng hay hàng
   ngoài ngành (đề bài: bán sai ngành là 0 điểm cả bài).
7. Nội dung người dùng nhập render bằng `textContent` hoặc `escapeHtml`. Thông báo tiếng Việt, giữ giọng văn hiện có.
8. Mỗi subagent **chỉ sửa các file trong cột "File được sửa"** của việc nó nhận. Cần sửa file khác thì dừng lại báo
   agent chính.
9. Ảnh tải từ internet là dữ liệu không tin cậy: tải vào thư mục tạm riêng, kiểm tra magic bytes, re-encode bằng `sharp`
   (đã có trong dependencies) rồi mới chép vào `data/product-images/`. Không chạy file tải về.

### Skill đã cài (trong `.agents/skills/`), dùng khi phù hợp

| Skill | Dùng khi |
|---|---|
| `domain-modeling` | Định nghĩa **Category**, **Tag** trong `GLOSSARY.md`, quyết định quan hệ với `brand` (S3-A) |
| `tdd` | Mọi thay đổi logic: viết test đỏ trước (S3-B, S3-C, S4-B, S5-A..C) |
| `frontend-design`, `ui-ux` | Màn hình admin danh mục/thẻ, chuẩn hoá ảnh, biểu đồ dashboard (S3-D, S3-E, S4-C) |
| `diagnosing-bugs` | Test fail chưa rõ nguyên nhân, lỗi chỉ thấy trên trình duyệt hoặc khi chạy 2 instance |
| `code-review` | Agent chính review toàn bộ diff trước khi đề xuất commit |

---

## 1. Quy trình điều phối (agent chính, lặp lại cho từng sprint)

1. **Chuẩn bị**: `git status` (chỉ được có `package-lock.json` và `docs/sprints/` đang sửa sẵn), `git switch master`,
   `git pull --ff-only`, `git switch -c <nhánh sprint>`, `npm test` để chốt mốc. Ghi lại số test.
2. **Giao việc** theo bảng sóng (wave) của sprint. Mỗi subagent nhận **nguyên văn** brief của việc đó + toàn bộ mục 0.
   Chạy song song các việc không phụ thuộc và **không trùng file**.
3. **Sau mỗi subagent**: đọc diff (`git diff -- <file>`), đối chiếu "Tiêu chí hoàn thành", chạy test liên quan.
   Chưa đạt thì gửi lại **chính subagent đó** kèm nhận xét cụ thể (file:dòng, kỳ vọng vs thực tế), tối đa 2 vòng,
   sau đó tự sửa.
4. Việc có migration: chạy `npm run db:migrate` rồi `npm run db:generate` trên DB local, sau đó `npm run db:reset:local`
   (seed lại) và `npm test`.
5. **Review tổng** (mục 5) → **kiểm tra trình duyệt** (mục 6) → **đề xuất commit** (mục 7) → **dừng, chờ người dùng**.

---

## 2. Sprint 3: Danh mục, thẻ và dữ liệu catalog đủ để demo

Nhánh `sprint/03-categories-catalog-data`. Mục tiêu:
1. Danh mục (loại thiết bị) do admin quản lý, không còn cố định trong code và CHECK constraint.
2. Có **thẻ** (tag) thật, tách khỏi hãng, phục vụ điều hướng và SEO.
3. Catalog có **đủ sản phẩm để thấy phân trang** ở ít nhất 2 danh mục, và **ảnh sản phẩm đồng bộ một phong cách**.

### Hiện trạng cần biết

- `public/js/catalog-taxonomy.js` là nguồn duy nhất cho `BRANDS` (8 hãng) và `DEVICE_TYPES` (laptop, keyboard, mouse,
  headphone, monitor, storage), dùng ở cả server (validation, SEO, seed) và trình duyệt (bộ lọc, admin).
- `products.brand` và `products.device_type` là `NVarChar(16)` có CHECK constraint (`products_brand_check`,
  `products_device_type_check`). Hàng phone/tablet cũ đã soft-delete và CHECK chỉ cho phép chúng khi `is_deleted = 1`.
- URL SEO: `/danh-muc/:category` và `/the/:tag` (`src/routes/catalog-seo.routes.js`,
  `src/controllers/catalog-seo.controller.js`, có sitemap ở ~dòng 100–104). Hiện "tag" **thực chất là hãng**
  (`/the/apple`).
- Seed: `prisma/seed-data.js` (24 sản phẩm, id 301–802, ảnh chính theo màu), `prisma/seed-gallery.js` (ảnh phụ),
  ảnh nằm ở `data/product-images/`, nguồn ghi ở `data/product-images/SOURCES.md`. Test đang cố định 24 sản phẩm:
  `test/seed-fixtures.test.js:411`, `test/store-reset.integration.test.js:34,36`.
- Số sản phẩm theo danh mục: laptop 5, keyboard 6, mouse 4, headphone 3, monitor 4, storage 2. Không danh mục nào
  vượt 12, nên **trang danh mục chưa bao giờ có trang 2**.
- `prisma/seed-fixtures.js` chia đơn demo theo giả định 24 sản phẩm (dòng ~367). Sprint 4 sẽ viết lại phần đơn hàng,
  ở Sprint 3 chỉ cần giữ nó chạy được khi số sản phẩm tăng.

### Thiết kế đã chốt (subagent không tự đổi)

- **Category** = bảng `categories` (`id`, `slug` unique, `name` tiếng Việt, `sort_order`, `is_deleted`, timestamps).
  Seed 6 hàng ứng với 6 `device_type` hiện có, **slug giữ nguyên** (`laptop`, `keyboard`, ...) để URL
  `/danh-muc/<slug>` không đổi.
- `products.category_id` (FK → `categories.id`, NOT NULL sau backfill). Cột `device_type` **giữ lại** ở sprint này
  (đồng bộ từ category khi ghi) để không phá code cũ, nhưng **bỏ CHECK** `products_device_type_check`. Đọc ở mọi nơi
  chuyển sang `category`. Xoá hẳn `device_type` để dành cho sprint sau, ghi chú trong spec.
- **Brand** giữ nguyên (cột + CHECK), không làm bảng riêng trong sprint này.
- **Tag** = bảng `tags` (`id`, `slug` unique, `name`, `is_deleted`) + bảng nối `product_tags` (`product_id`, `tag_id`,
  PK kép). Thẻ là thuộc tính tự do như `gaming`, `khong-day`, `van-phong`, `co-hoc`, `rgb`, `di-dong`.
- URL: `/the/:slug` trở thành **trang thẻ thật**. Trang hãng chuyển sang `/hang/:brand`. Các URL `/the/<slug hãng>`
  cũ (apple, samsung, msi, aula, logitech, razer, keychron, asus) trả **301** về `/hang/<brand>` để không gãy link.
  Sitemap liệt kê cả `/danh-muc/*`, `/hang/*`, `/the/*` có phân trang.
- Admin: thêm mục **"Danh mục & thẻ"** vào sidebar admin. Xoá danh mục là soft-delete và **bị chặn khi còn sản phẩm
  chưa xoá** thuộc danh mục đó. Đổi slug danh mục bị chặn khi có sản phẩm (tránh gãy URL). Mọi thao tác ghi audit log
  như các màn admin khác.
- **Ảnh**: chuẩn chung cho mọi ảnh sản phẩm (ảnh chính theo màu và ảnh gallery):
  - Nền **trắng tinh** `#FFFFFF`, khung **vuông 1200×1200**, sản phẩm căn giữa, lề trống khoảng 8–10% mỗi cạnh.
  - Chỉ có **sản phẩm**: không người, không cảnh sinh hoạt, không bàn làm việc, không nền tối/màu, không chữ quảng cáo,
    không logo khuyến mãi, không hộp sản phẩm.
  - Ảnh gallery là **các góc chụp khác** của cùng sản phẩm (trước, nghiêng, cạnh, sau/cổng kết nối, chi tiết cận).
  - Định dạng PNG (hoặc WebP nếu code đã hỗ trợ), mỗi file ≤ 400KB.
  - Mỗi sản phẩm có **ít nhất 3 ảnh tính cả ảnh chính** (giữ quy tắc của commit `ea44dc1`).

### Danh sách ảnh hiện tại bị lệch phong cách (agent chính đã soát bằng bảng ảnh thu nhỏ)

| Sản phẩm | File có vấn đề | Vấn đề |
|---|---|---|
| 301 MacBook Air M3 | `301-gallery-3.png` | Ảnh người mặc áo hoa ngồi dùng máy, cảnh đường phố |
| 302 MacBook Pro 14 M4 | `302-gallery-1/2/3.png` | Ảnh chụp màn hình/cảnh đêm, nền tối, khung 3:2 |
| 303 MacBook Air M2 | `303-midnight.jpg` (**ảnh chính**), `303-gallery-1/2/3.png` | Ảnh bài báo, máy đặt trên bàn có người, khung ngang |
| 304 MSI Katana 15 | `304-black-converted.png` (**ảnh chính**) | Banner khuyến mãi của cửa hàng, đầy chữ, nền đen |
| 401 Apple Magic Keyboard | `401-den.png`, `401-trang.png`, `401-gallery-1/2.png` | Khung quá dẹt (1200×403, 1166×207), trên thẻ sản phẩm chỉ là một vạch mảnh |
| 403 Aula F87 Pro | `403-gallery-1.png` | Ảnh hộp và phụ kiện trải phẳng, nhiều chữ |
| 404 Logitech MX Keys S | `404-gallery-3.png`, `404-gallery-4.png` | Ảnh dải mỏng 847×228; ảnh bàn làm việc nền tối nhìn từ trên |
| 405 Keychron K2 V2 | `405-gallery-1/2/3.png` | Ảnh bàn gỗ, nền tối, đạo cụ trang trí |
| 406 Keychron Q1 Max | `406-gallery-1/2/3.png` | Banner nền đen, keycap bay, khung rất ngang |
| 501 Apple Magic Mouse | `501-den.png`, `501-trang.png`, `501-gallery-2/3.png` | Khung dẹt; `501-gallery-3` là **dây cáp** không phải chuột |
| 502 Logitech MX Master 3S | `502-gallery-4.png` | Ảnh tay người cầm chuột, nền mờ |
| 504 Razer Viper V3 Pro | `504-gallery-1/2/3.png` | Ảnh nền xanh lá tối, cảnh gaming |
| 602 Razer BlackShark V2 Pro | `602-gallery-1/2/3.png` | Nền tím/xanh tối, ảnh rất ngang, cận chất liệu |
| 701 Samsung Odyssey G5 | `701-gallery-2.png` | Cận mặt sau nền xám tối, bị cắt |
| 702 MSI MAG274QRF-QD | `702-black.png` (**ảnh chính**) | Màn hình phủ đầy chữ/logo quảng cáo |
| 801 Samsung T7 Shield | `801-gallery-1/2/3.png` | Ảnh cảnh sinh hoạt, có người, nền tối |
| 802 Samsung 990 PRO | `802-gallery-1/2/3.png` | Ảnh hộp sản phẩm và cảnh lắp máy nền tối |

Ngoài danh sách trên, các ảnh còn lại đã đạt (nền trắng, chỉ có sản phẩm) nhưng **kích thước khung không đồng đều**
(394×394 đến 1600×1600, có ảnh 3:2, 4:3). Tất cả đều phải đi qua bước chuẩn hoá khung vuông ở S3-E.

### Việc của Sprint 3

#### S3-A: Thuật ngữ và spec (không code)

**File được sửa**: `GLOSSARY.md`, `docs/specs/product-categories-and-tags.md` (mới).

**Việc cần làm** (skill `domain-modeling`):
1. Thêm định nghĩa **Category**, **Tag**, và làm rõ **Brand** khác Tag thế nào. Ghi `_Avoid_` như các mục khác.
2. Viết spec ngắn: mô hình dữ liệu ở "Thiết kế đã chốt", quy tắc xoá/đổi slug, URL và redirect 301, các slice.

**Tiêu chí hoàn thành**: thuật ngữ khớp thiết kế, không mâu thuẫn với mục **Product** hiện có.

#### S3-B: Migration + Prisma schema + repository/service danh mục và thẻ

**File được sửa**: `prisma/schema.prisma`, `prisma/migrations/<timestamp>_categories_and_tags/migration.sql` (mới),
`src/repositories/category.repository.js` (mới), `src/repositories/tag.repository.js` (mới),
`src/services/category.service.js` (mới), `src/services/tag.service.js` (mới),
`test/category-tag.integration.test.js` (mới), `test-support/*` (chỉ thêm fake mới nếu cần).

**Việc cần làm** (skill `tdd`):
1. Migration theo thứ tự an toàn:
   - Tạo `categories`, chèn 6 hàng (slug + tên lấy từ `DEVICE_TYPE_LABELS`).
   - Thêm `products.category_id` NULL, backfill bằng `UPDATE ... JOIN categories ON slug = device_type`.
     Hàng soft-delete phone/tablet: tạo thêm 2 category `phone`, `tablet` với `is_deleted = 1` để backfill được, không
     hiện ở đâu cả.
   - Đổi `category_id` sang NOT NULL, thêm FK và index.
   - Drop CHECK `products_device_type_check`.
   - Tạo `tags`, `product_tags` (FK hai chiều, PK kép, index `tag_id`).
2. Service danh mục: list (công khai: chỉ chưa xoá, theo `sort_order`), create/update/softDelete cho admin, với các
   luật chặn ở "Thiết kế đã chốt". Lỗi trả mã rõ ràng (`CATEGORY_IN_USE`, `SLUG_TAKEN`, ...), message tiếng Việt.
3. Service thẻ: list, create/update/softDelete, gán thẻ cho sản phẩm (`setProductTags(productId, tagIds)`).
4. Slug: chữ thường không dấu, `a-z0-9-`, 2–40 ký tự, unique trong các hàng chưa xoá.

**Tiêu chí hoàn thành**: migration chạy được trên DB đang có 24 sản phẩm, không mất hàng nào; test mới phủ CRUD, slug
trùng, chặn xoá khi đang dùng, chặn đổi slug khi có sản phẩm; `npm test` xanh.

#### S3-C: Catalog, SEO và API dùng danh mục/thẻ từ DB

**File được sửa**: `public/js/catalog-taxonomy.js`, `src/services/product.service.js`,
`src/repositories/product.repository.js`, `src/controllers/catalog-seo.controller.js`,
`src/routes/catalog-seo.routes.js`, `src/routes/product.routes.js` (chỉ thêm route đọc danh mục/thẻ công khai nếu cần),
`public/js/main.js`, `public/js/catalog-renderer.js`, `test/product-taxonomy.integration.test.js`,
`test/catalog-seo*.test.js` (file hiện có hoặc mới).

**Phụ thuộc**: S3-B xong.

**Việc cần làm**:
1. `catalog-taxonomy.js` giữ `BRANDS` và hàm slug hãng; danh sách danh mục **không còn cố định**: server đọc từ
   `category.service`, trình duyệt lấy qua API công khai (ví dụ `GET /api/catalog/taxonomy` trả
   `{ categories, tags, brands }`). Giữ `DEVICE_TYPE_LABELS` làm **fallback** khi API lỗi để trang không trắng.
2. Lọc catalog: tham số `category` khớp `categories.slug`, thêm tham số `tag` lọc theo `product_tags`, `brand` cho hãng.
   **Tách** tham số hiện đang dùng `tag` cho hãng thành `brand`, nhưng vẫn chấp nhận `tag=<tên hãng>` cũ trong một
   sprint (map sang `brand`) để link cũ không gãy.
3. SEO: `/hang/:brand` render như trang `/the/:tag` cũ; `/the/:slug` render trang thẻ thật; `/the/<slug hãng>`
   trả 301 về `/hang/<brand>` (giữ query `page`). Sitemap cập nhật. Thẻ `<title>`, `<meta description>`, canonical
   đúng cho từng loại trang.
4. `/danh-muc/<slug>` của danh mục đã xoá hoặc không tồn tại trả 404 như hiện nay.

**Tiêu chí hoàn thành**: test phủ lọc theo danh mục/thẻ/hãng, 301 từ `/the/apple` về `/hang/apple`, sitemap có đủ
3 loại URL; URL `/danh-muc/laptop` và bộ lọc trên `catalog.html` vẫn chạy như trước.

#### S3-D: Màn hình admin "Danh mục & thẻ" + gán danh mục/thẻ trong form sản phẩm

**File được sửa**: `src/routes/admin.routes.js`, `src/controllers/admin-category.controller.js` (mới),
`public/admin.html`, `public/js/admin-shell.js`, `public/js/admin-categories.js` (mới), `public/js/admin.js`
(chỉ phần form sản phẩm: chọn danh mục từ API, chọn nhiều thẻ), `public/css/*` (chỉ file admin đang dùng),
`test/admin-categories.integration.test.js` (mới).

**Phụ thuộc**: S3-B xong (API), S3-C xong phần API taxonomy công khai.

**Việc cần làm** (skill `ui-ux`, `frontend-design`; bám đúng phong cách các màn admin hiện có như `admin-vouchers.js`,
dùng lại `admin-kit.js`):
1. API admin: `GET/POST /api/admin/categories`, `PATCH/DELETE /api/admin/categories/:id`, tương tự cho `tags`. Yêu cầu
   admin + CSRF cho mọi thao tác ghi, ghi audit log.
2. Màn hình: 2 tab (Danh mục, Thẻ), bảng có số sản phẩm đang dùng, modal tạo/sửa, nút xoá bị vô hiệu kèm lý do khi đang
   có sản phẩm. Phân trang luôn hiện số trang (giữ luật Sprint 1).
3. Form sản phẩm: `<select>` danh mục lấy từ API; ô chọn nhiều thẻ.
4. Tôn trọng cờ `ADMIN_EXTRAS`: màn này là **yêu cầu bắt buộc của đề**, nên **luôn hiện**, không ẩn sau cờ.

**Tiêu chí hoàn thành**: test API (quyền, CSRF, chặn xoá); trên trình duyệt tạo danh mục mới, gán cho một sản phẩm,
thấy nó trong bộ lọc catalog và `/danh-muc/<slug mới>`.

#### S3-E: Chuẩn hoá ảnh sản phẩm hiện có

**File được sửa**: `data/product-images/*`, `data/product-images/SOURCES.md`, `prisma/seed-gallery.js`,
`prisma/seed-data.js` (chỉ đổi tên file ảnh nếu cần), `scripts/images/normalize-product-images.js` (mới).

**Việc cần làm** (skill `frontend-design` để chốt cảm nhận thị giác):
1. Viết script `normalize-product-images.js` dùng `sharp`: nhận file nguồn, cắt bỏ viền trắng thừa (`trim`), đặt vào
   khung vuông 1200×1200 nền `#FFFFFF` với lề ~9%, nén PNG ≤ 400KB. Script nhận đường dẫn qua tham số, không tự tải mạng.
2. **Thay** mọi file trong bảng "Danh sách ảnh hiện tại bị lệch phong cách" bằng ảnh nền trắng chỉ có sản phẩm, lấy từ
   **trang sản phẩm chính hãng hoặc CDN chính hãng** (Apple store images với `fmt=png-alpha`, Logitech/Logitech G
   `resource.logitech*.com`, Razer `medias-p1.phoenix.razer.com`, Samsung `images.samsung.com`, MSI/Asus trang sản phẩm,
   Aula/Keychron Shopify CDN). Ưu tiên ảnh nền trong suốt hoặc trắng.
   - Nếu không tìm được đủ góc chụp nền trắng: dùng ít ảnh hơn nhưng vẫn **≥ 3 ảnh tính cả ảnh chính**. Có thể dùng
     ảnh màu khác của cùng sản phẩm làm ảnh gallery. **Không** giữ ảnh lệch phong cách chỉ để đủ số lượng.
3. Chạy script cho **toàn bộ** ảnh trong `data/product-images/` để đồng bộ khung.
4. Cập nhật `SOURCES.md`: mỗi file ghi nguồn tải và trang sản phẩm như định dạng hiện có. Xoá các dòng của ảnh đã bỏ.
   **Xoá file ảnh không còn dùng** (kiểm tra bằng grep trong `prisma/`).
5. Tạo lại bảng ảnh thu nhỏ (contact sheet, ví dụ bằng Python PIL hoặc `sharp`) **vào thư mục tạm, không commit**, để
   agent chính soát lại bằng mắt.

**Tiêu chí hoàn thành**: mọi ảnh trong `data/product-images/` là 1200×1200 nền trắng; không còn ảnh nào trong bảng
lệch phong cách; `SOURCES.md` khớp đúng danh sách file; trên thẻ sản phẩm ở catalog, các ảnh có kích thước sản phẩm
trông tương đương nhau.

#### S3-F: Thêm sản phẩm để demo phân trang

**File được sửa**: `prisma/seed-data.js`, `prisma/seed-gallery.js`, `data/product-images/*` (ảnh mới),
`data/product-images/SOURCES.md`, `prisma/seed-fixtures.js` (chỉ để seed chạy được với số sản phẩm mới),
`test/seed-fixtures.test.js`, `test/store-reset.integration.test.js`, các test khác đang cố định số 24.

**Phụ thuộc**: S3-E xong (để dùng script chuẩn hoá và tránh hai việc cùng sửa `SOURCES.md`); S3-B xong nếu seed phải
ghi `category_id`/thẻ.

**Việc cần làm**:
1. Thêm sản phẩm **chỉ dùng 8 hãng hiện có** (CHECK `brand` không đổi), để **bàn phím ≥ 14** và **chuột ≥ 14** (vượt
   12/trang, có trang 2). Gợi ý (subagent kiểm tra sản phẩm có thật, còn trang chính hãng):
   - Bàn phím (id 407–414): Aula F99, Aula F65, Keychron K8 Pro, Keychron V1 Max, Logitech MX Mechanical Mini,
     Logitech G515 Lightspeed TKL, Razer BlackWidow V4 75%, Asus ROG Strix Scope II 96 Wireless.
   - Chuột (id 505–514): Logitech G502 X Plus, Logitech MX Anywhere 3S, Logitech G305, Razer DeathAdder V3 Pro,
     Razer Basilisk V3, Asus ROG Keris II Ace, Asus ROG Harpe Ace Aim Lab, MSI Clutch GM41 Lightweight,
     Keychron M3 Mini, Aula SC580.
2. Mỗi sản phẩm mới theo đúng cấu trúc `buildProduct` hiện có: `intro`, `specs` đầy đủ tiếng Việt, 1–3 màu (mỗi màu
   một ảnh), biến thể có giá VND hợp lý, tồn kho, **≥ 3 ảnh tính cả ảnh chính**, đều qua script chuẩn hoá S3-E.
3. Gán thẻ (sau S3-B) cho **tất cả** sản phẩm, cũ lẫn mới, ví dụ `gaming`, `khong-day`, `van-phong`, `co-hoc`, `rgb`,
   `di-dong`, `sang-tao-noi-dung`; mỗi thẻ có ≥ 3 sản phẩm để trang `/the/<slug>` có nội dung.
4. Sửa các test đang cố định `24` sang số mới, tốt nhất là tính từ `seedData` thay vì hằng số.

**Tiêu chí hoàn thành**: `npm run db:reset:local` thành công; `/danh-muc/keyboard` và `/danh-muc/mouse` hiện "Trang 1, 2";
`/catalog.html` có ≥ 3 trang; mọi thẻ có ≥ 3 sản phẩm; `npm test` xanh.

### Sóng giao việc Sprint 3

| Sóng | Việc (song song trong sóng) | Ghi chú |
|---|---|---|
| 1 | S3-A, S3-B, S3-E | Không trùng file |
| 2 | S3-C, S3-F | S3-C cần S3-B; S3-F cần S3-B + S3-E |
| 3 | S3-D | Cần API từ S3-B, S3-C |

---

## 3. Sprint 4: Dữ liệu demo nhiều năm và dashboard nâng cao

Nhánh `sprint/04-demo-data-dashboard`. Mục tiêu: dashboard nâng cao (rubric #28) có dữ liệu trải **2 năm trở lên** để
thấy so sánh theo năm, quý, tháng, tuần; dashboard đơn giản (rubric #27) có đủ chỉ số và biểu đồ.

### Hiện trạng cần biết

- `prisma/seed-fixtures.js`: dữ liệu ngẫu nhiên có seed cố định (`PRNG_SEED = 0x5eed2026`), khách tạo cách nay ~100 ngày,
  khoảng 49 đơn trải từ 2026-08 đến 2026-11, cộng một nhóm đơn "48 giờ gần nhất" (`RECENT`, ~dòng 83–92) để demo trạng thái.
  Có luật cộng điểm (`creditLoyalty`), voucher theo vị trí đơn, đánh giá.
- `src/services/admin-period.js`: múi giờ +7, các mức `year`, `quarter`, `month`, `week`, ranh giới tuần bắt đầu thứ Hai.
- `src/services/admin-dashboard.service.js`, `public/js/admin-dashboard.js` (biểu đồ cột bằng CSS),
  `public/js/admin-overview.js`, `public/js/admin-orders.js` (lọc today/yesterday/week/month/custom, `PAGE_SIZE = 20`).
- Giá vốn: `products.cost_price`, `order_items.unit_cost` (mặc định 80% giá bán, migration `p2_foundation`).

### Việc của Sprint 4

#### S4-A: Viết lại phần sinh đơn demo trải 2 năm

**File được sửa**: `prisma/seed-fixtures.js`, `test/seed-fixtures.test.js`.

**Việc cần làm** (skill `tdd`):
1. Khách hàng: ~60 tài khoản, ngày tạo rải từ **2024-11** đến nay (có tháng tăng đột biến), để chỉ số "khách mới" theo
   kỳ có ý nghĩa. Giữ các tài khoản demo hiện có (email, mật khẩu seed) **không đổi**.
2. Đơn hàng: ~600–900 đơn từ **2024-11-01** đến hôm nay, mật độ có mùa vụ (cao vào tháng 6–8 mùa tựu trường, tháng 11
   Black Friday, tháng 12–1 Tết), năm sau cao hơn năm trước khoảng 20–40% để biểu đồ so sánh rõ.
   Trạng thái hợp lý theo tuổi đơn (đơn cũ phần lớn `DELIVERED`, có tỉ lệ `CANCELLED`), phương thức thanh toán đa dạng,
   một phần dùng voucher và điểm, `unit_cost` = `cost_price` tại thời điểm đó.
3. Giữ nguyên nhóm đơn `RECENT` (48 giờ) và mọi bất biến hiện có: điểm chỉ cộng khi đủ điều kiện, voucher không vượt
   giới hạn 10 lần dùng, tồn kho không âm, đơn chỉ chứa sản phẩm **chưa xoá** tại thời điểm đặt.
4. Phân bổ sản phẩm theo độ phổ biến (chuột, bàn phím bán nhiều; laptop, màn hình ít hơn nhưng doanh thu cao) để
   "sản phẩm bán chạy" khác "doanh thu cao nhất".
5. Seed vẫn **tất định** (cùng seed PRNG ra cùng dữ liệu), chạy dưới ~60 giây trên máy local; nếu cần, chèn theo lô
   (`createMany`).

**Tiêu chí hoàn thành**: test seed kiểm tra: đơn sớm nhất ≤ 2024-11-30, có đơn trong mọi tháng, năm 2026 > năm 2025
về doanh thu, các bất biến điểm/voucher/tồn kho; `npm run db:reset:local` thành công.

#### S4-B: Kiểm chứng dịch vụ dashboard qua ranh giới thời gian

**File được sửa**: `src/services/admin-period.js`, `src/services/admin-dashboard.service.js`,
`test/admin-dashboard.integration.test.js`, `test/admin-period.test.js` (mới nếu chưa có).

**Việc cần làm** (skill `tdd`):
1. Test ranh giới: đơn lúc 23:30 ngày 31/12 giờ VN thuộc năm cũ, 00:10 ngày 1/1 thuộc năm mới; tuần vắt qua năm; quý 4
   sang quý 1; khoảng tự chọn qua hai năm.
2. Đảm bảo dashboard trả đủ chuỗi theo kỳ (kỳ không có đơn trả 0, không bị thiếu cột) cho: doanh thu, lợi nhuận
   (`doanh thu - Σ unit_cost × qty`, trừ đơn huỷ), số đơn, số sản phẩm bán ra, số loại sản phẩm bán ra, khách mới.
3. Thêm **so sánh với kỳ trước** (ví dụ năm 2026 so với 2025: chênh lệch %) nếu service chưa có.
4. Hiệu năng: truy vấn gom nhóm ở SQL, không tải toàn bộ đơn vào bộ nhớ khi có ~900 đơn.

**Tiêu chí hoàn thành**: các test ranh giới xanh; phản hồi dashboard theo năm với dữ liệu seed < 500ms trên local.

#### S4-C: Giao diện dashboard

**File được sửa**: `public/js/admin-dashboard.js`, `public/js/admin-overview.js`, `public/css/*` (chỉ file admin
dashboard), `public/admin.html` (chỉ phần dashboard).

**Phụ thuộc**: S4-B xong (dạng dữ liệu trả về).

**Việc cần làm** (skill `dataviz` nếu có, `ui-ux`, `frontend-design`):
1. Dashboard đơn giản: thẻ chỉ số (tổng người dùng, người dùng mới, số đơn, doanh thu) + biểu đồ sản phẩm bán chạy.
2. Dashboard nâng cao: bộ chọn kỳ (Năm mặc định, Quý, Tháng, Tuần, Khoảng tự chọn), biểu đồ doanh thu và lợi nhuận theo
   kỳ, số đơn, số sản phẩm và loại sản phẩm bán ra, so sánh với kỳ trước.
3. Biểu đồ: giữ cách vẽ hiện tại (CSS/SVG thuần, không thêm thư viện), có trục, nhãn số dạng `1,2 tỷ`, tooltip, đọc được
   ở 360px (cuộn ngang trong khung biểu đồ, không cuộn cả trang), có trạng thái loading/rỗng/lỗi.

**Tiêu chí hoàn thành**: trên trình duyệt đổi qua 5 chế độ kỳ đều có dữ liệu và biểu đồ hợp lý; không lỗi console.

### Sóng giao việc Sprint 4

| Sóng | Việc | Ghi chú |
|---|---|---|
| 1 | S4-A, S4-B | Không trùng file |
| 2 | S4-C | Cần dạng dữ liệu từ S4-B, dữ liệu từ S4-A |

---

## 4. Sprint 5: Mở rộng ngang (horizontal scaling)

Nhánh `sprint/05-horizontal-scaling`. Mục tiêu: chạy **2 instance app trở lên sau một load balancer** bằng
**Docker Compose**, ứng dụng **không giữ trạng thái trong bộ nhớ** ảnh hưởng tới tính đúng, có bằng chứng rõ ràng.

### Hiện trạng cần biết

- Xác thực bằng **JWT** (`jsonwebtoken`, `src/middlewares/auth.js`), không có session server: đã stateless.
- Trạng thái trong bộ nhớ từng process:
  - `src/middlewares/auth.js:34` `rateBuckets = new Map()`: rate limit đăng nhập, gửi lại mail, khôi phục, bình luận
    khách (`guestReview`, dùng ở `src/routes/product.routes.js:22`).
  - `src/realtime/review-hub.js`: `rooms` (productId → các WebSocket) và `perIp`: một đánh giá ghi ở instance A
    **không** tới người xem đang nối vào instance B.
  - `src/services/payment-expiration.worker.js:24` `setInterval`: mỗi instance đều chạy worker hết hạn thanh toán, có
    thể xử lý trùng.
- Ảnh tải lên lưu trên đĩa: `src/services/product-image-storage.js` (`PRODUCT_IMAGE_STORAGE_DIR`, mặc định
  `data/product-images`), phục vụ ở `src/app.js:34`.
- Chưa có `Dockerfile`, `docker-compose.yml`, `/healthz`.

### Thiết kế đã chốt

- **Redis là tuỳ chọn**: có `REDIS_URL` thì dùng Redis, không có thì giữ hành vi một process như hiện nay (để `npm start`
  và `npm test` không cần Redis). Thư viện: `ioredis` (thêm vào `dependencies`, ghim phiên bản chính xác).
- Rate limit: interface chung `{ hit(key, windowMs) → count }`, hai bản cài đặt: bộ nhớ (hiện có) và Redis
  (`INCR` + `PEXPIRE` trong `MULTI`, hoặc script Lua).
- WebSocket đánh giá: khi có Redis, mỗi thay đổi đánh giá **publish** lên kênh `reviews:<productId>`; mọi instance
  **subscribe** và phát lại cho client cục bộ. Không có Redis thì phát trực tiếp như hiện nay.
- Worker hết hạn thanh toán: mỗi lượt chạy bọc trong `sp_getapplock` của SQL Server (khoá phiên, `@LockTimeout = 0`):
  instance không lấy được khoá thì bỏ qua lượt đó. Không cần Redis.
- Ảnh tải lên: trong Compose, mọi instance mount **cùng một volume** vào `PRODUCT_IMAGE_STORAGE_DIR`.
- `GET /healthz`: trả `200 { status: "ok", db: "ok", redis: "ok" | "disabled", instance: <hostname> }`, trả 503 khi DB
  không kết nối được. Thêm header `X-Instance` (hostname) vào mọi phản hồi để chứng minh cân bằng tải.
- Load balancer: **nginx** (round-robin, hỗ trợ nâng cấp WebSocket `Upgrade`/`Connection`), cổng ngoài 8080.
- SQL Server: Compose **không** chạy SQL Server mặc định; app nối vào DB qua `DATABASE_URL` từ file `.env` của người
  dùng (`host.docker.internal`). Có thể thêm profile `db` dùng image `mcr.microsoft.com/mssql/server:2022-latest` cho ai
  cần, nhưng không bắt buộc.

### Việc của Sprint 5

#### S5-A: Rate limit dùng chung

**File được sửa**: `src/middlewares/auth.js`, `src/infra/redis.js` (mới: tạo client từ `REDIS_URL`, đóng khi tắt),
`src/infra/rate-limit-store.js` (mới), `src/server-lifecycle.js` (chỉ đóng Redis khi tắt),
`test/rate-limit-store.test.js` (mới), `package.json`, `.env.example`.

**Việc cần làm** (skill `tdd`): tách store như "Thiết kế đã chốt"; test bản bộ nhớ đầy đủ; test bản Redis bằng fake
client trong `test-support/` (không cần Redis thật trong `npm test`). Hành vi khi Redis lỗi: **ghi log và cho qua**
(fail-open) để Redis sập không khoá đăng nhập của mọi người, ghi rõ quyết định này trong comment.

**Tiêu chí hoàn thành**: không có `REDIS_URL` thì mọi test rate limit cũ vẫn xanh, không đổi hành vi.

#### S5-B: WebSocket đánh giá qua Redis pub/sub

**File được sửa**: `src/realtime/review-hub.js`, `src/realtime/review-bus.js` (mới), `src/services/review.service.js`
(chỉ điểm gọi broadcast, nếu cần), `test/review-realtime.integration.test.js`.

**Phụ thuộc**: S5-A xong (dùng chung `src/infra/redis.js`).

**Việc cần làm** (skill `tdd`): bus có 2 bản (trực tiếp / Redis); Redis cần **2 kết nối** (một publish, một subscribe).
Test mô phỏng 2 hub dùng chung một fake bus: đánh giá tạo ở hub A tới client của hub B, và không phát trùng ở A.

**Tiêu chí hoàn thành**: test 2-hub xanh; test realtime cũ xanh.

#### S5-C: Worker hết hạn thanh toán chạy đúng một nơi

**File được sửa**: `src/services/payment-expiration.worker.js`, `src/repositories/*` (chỉ thêm hàm lấy/nhả khoá nếu
cần), `test/payment-expiration*.test.js` (hiện có hoặc mới).

**Việc cần làm** (skill `tdd`): bọc mỗi lượt trong `sp_getapplock`/`sp_releaseapplock` dùng **một kết nối/transaction**
(`$transaction` của Prisma với `$queryRaw`), khoá tên `digishop:payment-expiration`. Không lấy được khoá thì bỏ qua và
ghi log mức debug.

**Tiêu chí hoàn thành**: test chứng minh hai worker chạy đồng thời thì chỉ một bên xử lý; hành vi đơn lẻ không đổi.

#### S5-D: Healthz, header instance, Docker Compose, nginx và tài liệu

**File được sửa**: `src/app.js` (chỉ thêm `/healthz` và header `X-Instance`), `src/routes/health.routes.js` (mới),
`Dockerfile` (mới), `.dockerignore` (mới), `docker-compose.yml` (mới), `deploy/nginx/nginx.conf` (mới),
`docs/scaling.md` (mới), `.env.example`, `test/health.integration.test.js` (mới).

**Phụ thuộc**: S5-A, S5-B, S5-C xong.

**Việc cần làm**:
1. `Dockerfile` nhiều tầng: `node:20-alpine` (hoặc bản Node đang dùng trên máy, kiểm tra `node -v`), `npm ci --omit=dev`,
   `prisma generate` lúc build, chạy bằng user không phải root, `HEALTHCHECK` gọi `/healthz`.
2. `.dockerignore`: loại `.env`, `node_modules`, `.git`, `data/product-images` (ảnh đi qua volume), `test`, `docs`.
3. `docker-compose.yml`: dịch vụ `app` với `deploy.replicas: 3` (hoặc `app1..app3` nếu Compose không hỗ trợ replicas
   trên máy), `redis:7-alpine`, `nginx`; volume `product-images` dùng chung; `env_file: .env` +
   `REDIS_URL=redis://redis:6379`; một dịch vụ `migrate` chạy `npm run db:migrate` một lần trước app.
4. `nginx.conf`: upstream round-robin tới app, proxy WebSocket, `proxy_set_header X-Forwarded-For`, app bật
   `trust proxy` để rate limit đúng IP thật (kiểm tra `src/app.js` đã có chưa).
5. `docs/scaling.md` (tiếng Việt): sơ đồ kiến trúc, những gì đã làm stateless và vì sao, cách chạy
   `docker compose up --build`, cách **chứng minh**: gọi `/healthz` nhiều lần thấy `instance` luân phiên; mở 2 tab chi
   tiết sản phẩm, đánh giá ở tab này thấy ngay ở tab kia dù khác instance; tắt một container (`docker compose stop`)
   web vẫn chạy. Ghi chỗ để chèn ảnh chụp minh chứng cho bài nộp.

**Tiêu chí hoàn thành**: `docker compose config` hợp lệ; nếu máy có Docker: `docker compose up --build` chạy được,
`curl localhost:8080/healthz` luân phiên instance (nếu không có Docker thì ghi rõ "chưa chạy thật" trong báo cáo, không
được nói là đã kiểm tra); `npm test` xanh khi không có `REDIS_URL`.

### Sóng giao việc Sprint 5

| Sóng | Việc | Ghi chú |
|---|---|---|
| 1 | S5-A, S5-C | Không trùng file |
| 2 | S5-B | Cần `src/infra/redis.js` từ S5-A |
| 3 | S5-D | Cần cả ba việc trên |

---

## 5. Review tổng (agent chính, cuối mỗi sprint)

1. Chạy skill `code-review` trên toàn bộ diff của sprint.
2. Kiểm tra tay:
   - `git status`: chỉ có các file thuộc sprint (cộng `package-lock.json` và `docs/sprints/` sẵn có).
   - Không còn chuỗi cố định danh mục ngoài fallback (`grep -rn "\"keyboard\"\|'keyboard'" src public/js`), không còn
     số `24` cố định trong test (Sprint 3).
   - Mọi chỗ render tên danh mục/thẻ/sản phẩm dùng `escapeHtml` hoặc `textContent`.
   - Migration mới chạy được trên DB có sẵn dữ liệu và trên DB trắng (`npm run db:reset:local`).
   - Không có ảnh nào trong `data/product-images/` mà không có dòng trong `SOURCES.md`, và ngược lại (Sprint 3).
   - Không có bí mật hay `.env` trong diff; `.dockerignore` loại `.env` (Sprint 5).
3. `npm test`: số pass ≥ mốc đầu sprint, 0 fail.

## 6. Kiểm tra trên trình duyệt (PORT=3100, sau mỗi sprint)

**Sprint 3**
1. `/danh-muc/keyboard` và `/danh-muc/mouse`: thấy phân trang "1, 2", sang trang 2 có sản phẩm.
2. `/catalog.html`: ≥ 3 trang; lọc theo danh mục, hãng, thẻ, giá đều chạy.
3. `/the/apple` chuyển 301 sang `/hang/apple`; `/the/gaming` hiện sản phẩm có thẻ gaming.
4. Admin: tạo danh mục mới, gán cho một sản phẩm, thấy ở catalog; thử xoá danh mục đang dùng thì bị chặn kèm lý do.
5. Soát ảnh: trang chủ, catalog, chi tiết 5 sản phẩm bất kỳ (gồm 303, 304, 401, 501, 702): ảnh nền trắng, kích thước
   sản phẩm trên thẻ tương đương nhau, không ảnh nào bị dẹt hay có chữ quảng cáo. Chụp màn hình 360px và 1280px.

**Sprint 4**
6. Dashboard: chuyển Năm, Quý, Tháng, Tuần, Khoảng tự chọn (ví dụ 01/06/2025–31/08/2026): số liệu và biểu đồ hợp lý,
   có so sánh kỳ trước. Kiểm tra ở 360px.
7. Danh sách đơn admin: lọc "Tháng này", "Tuỳ chọn" qua 2 năm, phân trang nhiều trang.

**Sprint 5**
8. Không có `REDIS_URL`: app chạy và đánh giá realtime như cũ.
9. Có Docker: theo `docs/scaling.md`, chứng minh luân phiên instance và realtime chéo instance. Không có Docker: ghi rõ.

## 7. Báo cáo và đề xuất commit (cuối mỗi sprint, rồi dừng)

Báo cáo bằng tiếng Việt cho người dùng:
1. Tóm tắt thay đổi theo từng việc (S3-A...), file chính, quyết định đáng chú ý.
2. Kết quả `npm test` (mốc trước/sau), kết quả kiểm tra trình duyệt, phần **chưa kiểm tra được** và lý do.
3. Đề xuất commit theo nhóm file, mỗi commit một lệnh `git add` **trên một dòng**, message theo quy ước, kết thúc bằng
   `Co-Authored-By: Claude <noreply@anthropic.com>`. Gợi ý:

**Sprint 3**
- `docs(catalog): define categories and tags`
- `feat(catalog): store categories and tags in the database`
- `feat(catalog): filter and browse by category, brand and tag with brand pages under /hang`
- `feat(admin): manage categories and tags`
- `chore(seed): normalize product photos to square white-background shots`
- `chore(seed): add keyboards and mice so category pages paginate`

**Sprint 4**
- `chore(seed): spread demo customers and orders over two years`
- `feat(admin): compare dashboard periods and cover year boundaries`
- `feat(admin): period picker and revenue, profit and product charts on the dashboard`

**Sprint 5**
- `feat(infra): share auth rate limits through optional redis`
- `feat(review): fan out realtime review updates across instances`
- `fix(payment): run payment expiration on one instance at a time`
- `feat(infra): health check, docker compose and nginx load balancing`

4. **Dừng lại, chờ người dùng duyệt**. Không commit, không push, không sang sprint sau khi chưa được đồng ý.
