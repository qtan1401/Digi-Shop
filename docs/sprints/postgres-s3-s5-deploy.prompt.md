# PostgreSQL, Sprint 3–5, Cloudinary, Cloud Run: prompt cho agent chính (Digi-Shop)

> File này là **prompt điều phối**. Agent chính đọc toàn bộ, chia việc, giao từng việc nhỏ cho **subagent**,
> sau đó tự **review, chạy test, kiểm tra trên trình duyệt**, rồi **chỉ đề xuất** commit.
>
> Thứ tự bắt buộc: **Giai đoạn 0 → P (PostgreSQL) → 3 → 4 → 5 (scaling + Cloudinary) → D (deploy)**.
> Hết mỗi giai đoạn có một **CỔNG DỪNG**: agent chính báo cáo, đề xuất commit rồi **dừng hẳn**.
> Người dùng tự test trên máy, tự quyết định commit. Chỉ sang giai đoạn sau khi người dùng nói rõ "tiếp tục".
>
> **Giai đoạn D (deploy) chỉ được bắt đầu khi người dùng đã test local xong mọi thứ và nói rõ "bắt đầu deploy".**
> Trước thời điểm đó, không tạo tài khoản, không chạy `gcloud`, không đụng Neon hay Cloudinary thật.
>
> File này thay cho mục 4 (Sprint 5) của `docs/sprints/sprint-03-05.prompt.md`. Mục 2 (Sprint 3) và mục 3 (Sprint 4)
> của file đó **vẫn dùng**, với các điều chỉnh ghi ở mục 5 và 6 dưới đây.

---

## 0. Bối cảnh bắt buộc phải đọc trước

- Repo `A:\Digi-Shop`, nhánh gốc `master`. Node.js v24, Express (CommonJS, 4 spaces), Prisma **7.10.0**, frontend HTML/JS
  thuần trong `public/`, test bằng `node --test` (`npm test`, mốc hiện tại **359 pass / 0 fail**).
- Đề bài: `A:\NodeJS Final Project.pdf`. Liên quan trực tiếp:
  - **Deploy là điều kiện để bài được chấm**: *"If your team fails to deploy the project (e.g., public hosting or Docker
    Compose) ... the submission will not be graded."* Web deploy phải chạy như ở local, kèm tài khoản admin.
  - **#35 Horizontal scaling (0,5đ)**: *"utilizes multiple servers, employs load balancing, and maintains a stateless
    architecture"*, phải có bằng chứng rõ ràng.
  - Pagination, categories/tags, advanced dashboard: xem `sprint-03-05.prompt.md`.
- Hướng đã chốt với người dùng:
  - **Database**: SQL Server → **PostgreSQL**. Local: PostgreSQL cài trên máy. Production: **Neon** (gói miễn phí).
  - **Ảnh admin tải lên**: **Cloudinary** (production). Ảnh mẫu của seed vẫn nằm trong repo và đi kèm bản build.
  - **Chạy app**: **Google Cloud Run**, nhiều instance, load balancer có sẵn. **Không dùng Docker trên máy người dùng**
    (Cloud Build đóng gói trên cloud).
  - **Không dùng Redis.** Trạng thái dùng chung giữa các instance đi qua PostgreSQL.
- Đọc `AGENTS.md`, `GLOSSARY.md`, `docs/agents/domain.md` để dùng đúng thuật ngữ.
- Quy ước commit: Conventional Commits, tiếng Anh, chữ thường sau `:`, có scope. Dòng cuối mỗi message:
  `Co-Authored-By: Claude <noreply@anthropic.com>`. Mỗi lệnh `git add` viết **trên một dòng**.

### Hiện trạng kỹ thuật đã khảo sát (để giao việc chính xác)

**Lớp kết nối DB**
- `src/db/config.js`: bắt buộc 10 biến (`DATABASE_URL`, `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
  `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `DB_CONNECT_TIMEOUT_MS`, `DB_POOL_MAX`) và dựng cấu hình `mssql`.
- `src/db/prisma.js`: dùng `@prisma/adapter-mssql`; `verifyDatabaseSchema` đọc `INFORMATION_SCHEMA` với `[dbo]`, `N'...'`,
  `TOP (1)`.
- `src/server-lifecycle.js:31–33`: đọc mã lỗi kiểu `mssql` (`error.number`, `originalError.info.number`).
- `scripts/db/create-database.js`: tạo DB bằng `mssql`. `prisma.config.cjs` đọc `DATABASE_URL`.
- `prisma/schema.prisma`: `provider = "sqlserver"`, 23 model; kiểu `@db.NVarChar` (84 chỗ), `@db.DateTime2` (49),
  `@db.Decimal` (13), `@db.Char` (5), `@db.TinyInt` (1); 29 default `dbgenerated("SYSUTCDATETIME()")`.
- `prisma/migrations/`: 15 migration (~670 dòng SQL Server), `migration_lock.toml` là `mssql`. Có **34 CHECK constraint**
  và **filtered unique index** (ví dụ `product_reviews_product_user_key ... WHERE [user_id] IS NOT NULL`; tìm hết bằng
  grep `WHERE` trong các file `CREATE ... INDEX`).

**SQL viết tay (20 chỗ trong 10 file)**

| File | Cú pháp riêng SQL Server |
|---|---|
| `src/repositories/cart.repository.js` (~151, ~160) | `UPDLOCK`, `HOLDLOCK`, `ROWLOCK`, `[dbo]` |
| `src/repositories/checkout.repository.js` (~127) | `UPDLOCK`, `HOLDLOCK`, `ROWLOCK` |
| `src/repositories/order.repository.js` (~347, ~392) | `UPDLOCK`, `ROWLOCK` |
| `src/repositories/payment.repository.js` (~32) | `UPDLOCK`, `ROWLOCK` |
| `src/repositories/loyalty.repository.js` (~18) | `UPDLOCK`, `ROWLOCK` |
| `src/repositories/voucher.repository.js` (~81, ~88, ~212, ~225, ~232) | `SYSUTCDATETIME()`, `LOCK_SELECT` có `UPDLOCK/HOLDLOCK`, `LEN()`, `LIKE '%[^A-Za-z0-9]%'`, `OFFSET/FETCH NEXT` |
| `src/repositories/product.repository.js` (~380–413) | Tìm kiếm `CHARINDEX(... COLLATE Latin1_General_100_CI_AI)` (không phân biệt hoa thường **và dấu**), sắp xếp `COLLATE Vietnamese_100_CI_AS`, `OFFSET/FETCH`, `CAST` |
| `src/repositories/landing.repository.js` (~43) | `TOP (n)` |
| `src/repositories/admin-dashboard.repository.js` (~34, ~69, ~80) | `DATEFROMPARTS`, `DATEPART`, `DATEADD`, `DATEDIFF`, `CAST`, `N'...'` |
| `src/repositories/auth.repository.js` (~113) | `SYSUTCDATETIME()` |

**Truy vấn Prisma phụ thuộc collation**: SQL Server mặc định **không phân biệt hoa thường**, PostgreSQL thì có.
`contains` ở các file sau sẽ đổi hành vi nếu không thêm `mode: "insensitive"`:
`src/repositories/admin-user.repository.js:36–38`, `src/repositories/order.repository.js:210–212`,
`src/services/product.service.js:347–348`, `src/services/review.service.js:314–315`.
Email và username đã được chuẩn hoá chữ thường trong code (`auth.service.js:29–30`), nên ràng buộc unique vẫn đúng.

**Seed**: `prisma/seed.js` (~1.300 dòng) viết **toàn bộ** bằng thư viện `mssql`: `[dbo]` (49 chỗ), `UPDLOCK/HOLDLOCK`,
`OUTPUT INSERTED`, `SET IDENTITY_INSERT`, `sql.NVarChar(...)`. `prisma/seed-data.js`, `seed-fixtures.js`,
`seed-gallery.js` chỉ là dữ liệu, không phụ thuộc DB.

**Test**: gần như mọi integration test **dùng fake Prisma** (ví dụ `test/landing.integration.test.js:15`
`db.getPrismaClient = () => fake.prisma`). Nghĩa là **`npm test` không chạy thử SQL viết tay trên DB thật**.
Ngoại lệ: `test/store-reset.integration.test.js` (chuỗi kết nối `sqlserver://` giả) và
`test/store-reset-rollback.integration.test.js` (`require("mssql")`).
→ Vì vậy giai đoạn P **bắt buộc** có bộ test chạy trên DB thật (việc P-1).

**Ảnh**: `src/services/product-image-storage.js` ghi file vào `PRODUCT_IMAGE_STORAGE_DIR` (mặc định
`data/product-images`), trả `/uploads/products/<uuid>.png|webp`; `src/app.js:34` phục vụ thư mục này. Hàm
`uploadedImageFromPublicPath` chỉ nhận đường dẫn dạng UUID để không xoá nhầm ảnh mẫu.

**Trạng thái trong bộ nhớ** (cản trở chạy nhiều instance):
- `src/middlewares/auth.js:34` `rateBuckets = new Map()` (rate limit đăng nhập, gửi lại mail, khôi phục, bình luận
  khách `guestReview` ở `src/routes/product.routes.js:22`).
- `src/realtime/review-hub.js`: `rooms`, `perIp`; đánh giá ở instance A không tới người xem ở instance B.
- `src/services/payment-expiration.worker.js:24` `setInterval` chạy ở **mọi** instance.
- Xác thực dùng JWT + bảng `refresh_sessions`: đã stateless. `src/app.js:26` đã có `trust proxy` theo `TRUST_PROXY`.
- `public/js/review-live.js` đã có tự kết nối lại (giãn thời gian ngẫu nhiên) và theo dõi `visibilitychange`.

### Ràng buộc an toàn (agent chính VÀ mọi subagent)

1. **Mỗi giai đoạn một nhánh** tạo từ `master` mới nhất, sau khi người dùng đã commit/merge giai đoạn trước:
   `phase/p-postgresql`, `sprint/03-categories-catalog-data`, `sprint/04-demo-data-dashboard`,
   `sprint/05-scaling-cloudinary`, `phase/d-cloud-run`. **Không commit, không push, không merge** (chỉ đề xuất).
2. **Không** sửa `.env`, không in hay chép giá trị bí mật vào chat, log, file hoặc commit. Biến mới chỉ thêm vào
   `.env.example` với giá trị mẫu. Khi cần đổi `.env`, **ghi hướng dẫn để người dùng tự đổi**.
3. Không chạy `npm audit fix`. Thêm hoặc bỏ dependency **chỉ** khi brief cho phép, ghim **phiên bản chính xác**, và khi đó
   `package-lock.json` được đưa vào đề xuất commit (ghi rõ lý do). Ngoài các trường hợp đó, không stage
   `package-lock.json`.
4. **Không cài phần mềm hệ thống** (PostgreSQL, gcloud CLI...), không tạo tài khoản dịch vụ nào. Việc đó là của người dùng.
5. Server dev của người dùng có thể đang chạy ở cổng **3000**: không kill. Agent chạy app ở **`PORT=3100`**
   (PowerShell: `$env:PORT=3100; npm start`), cụm nhiều instance ở 3101–3103 và 8080. Tắt mọi tiến trình mình bật khi xong.
   PowerShell 5.1: không dùng `&&`, dùng `;`.
6. **Không xoá, không sửa** database SQL Server `DigiShop` đang có trên máy: nó là đường lui nếu PostgreSQL có vấn đề.
7. Chỉ bán **máy tính và linh kiện, phụ kiện máy tính** (bán sai ngành là 0 điểm cả bài).
8. Nội dung người dùng nhập render bằng `textContent` hoặc `escapeHtml`. Thông báo tiếng Việt, giữ giọng văn hiện có.

### Quy tắc cách ly cho mọi subagent (dán nguyên văn vào mỗi brief)

> 1. Chỉ được sửa, tạo hoặc xoá các file trong mục **"File được sửa"** của việc mình nhận. Cần đụng file khác thì
>    **dừng lại báo agent chính**, không tự sửa.
> 2. **Không đổi hành vi** ngoài phạm vi việc được giao. Không refactor, không đổi tên hàm/biến/export, không đổi chữ ký
>    hàm, không định dạng lại code (khoảng trắng, xuống dòng, thứ tự import) ở những đoạn không liên quan.
> 3. Port SQL thì giữ **nguyên kết quả trả về**: cùng tên cột (alias), cùng kiểu dữ liệu sau khi qua Prisma (number,
>    string, Date, Decimal), cùng thứ tự sắp xếp, cùng điều kiện lọc, cùng mã lỗi và message ném ra.
> 4. Test đang có phải **pass mà không sửa**, trừ những file test được ghi rõ trong "File được sửa".
> 5. Cuối việc, báo cáo: danh sách file đã đổi, lý do từng thay đổi, lệnh test đã chạy và kết quả, điều gì chưa chắc.

### Skill đã cài (trong `.agents/skills/`), dùng khi phù hợp

| Skill | Dùng khi |
|---|---|
| `tdd` | Mọi thay đổi logic: viết hoặc chỉnh test trước, rồi sửa code cho xanh |
| `diagnosing-bugs` | Test fail chưa rõ nguyên nhân, lỗi chỉ thấy trên DB thật, trên trình duyệt hoặc khi chạy nhiều instance |
| `domain-modeling` | Cập nhật `GLOSSARY.md`, spec khi đổi khái niệm (Category, Tag) |
| `frontend-design`, `ui-ux` | Màn hình admin, ảnh sản phẩm, dashboard |
| `code-review` | Agent chính review toàn bộ diff trước mỗi cổng dừng |

---

## 1. Quy trình điều phối (agent chính, lặp lại cho từng giai đoạn)

1. **Chuẩn bị**: `git status` sạch (chỉ cho phép `package-lock.json` và `docs/sprints/` đang sửa sẵn), `git switch master`,
   `git pull --ff-only`, `git switch -c <nhánh giai đoạn>`, chạy `npm test` (và `npm run test:db` từ sau giai đoạn P)
   để chốt mốc. Ghi lại số test.
2. **Giao việc** theo bảng sóng của giai đoạn. Mỗi subagent nhận **nguyên văn**: brief của việc đó + toàn bộ mục 0
   (bối cảnh, ràng buộc, quy tắc cách ly). Chạy song song chỉ khi các việc **không trùng file**.
3. **Sau mỗi subagent**: đọc diff (`git diff -- <file>`), kiểm tra không có thay đổi ngoài danh sách file, đối chiếu
   "Tiêu chí hoàn thành", chạy test liên quan. Chưa đạt thì gửi lại **chính subagent đó** kèm nhận xét cụ thể
   (file:dòng, kỳ vọng vs thực tế), tối đa 2 vòng, sau đó tự sửa.
4. **Review tổng** (mục 9) → **kiểm tra trên trình duyệt** theo checklist của giai đoạn → **báo cáo + đề xuất commit**
   (mục 10) → **CỔNG DỪNG**.

---

## 2. Giai đoạn 0: Mốc an toàn (agent chính tự làm, không cần subagent)

1. `npm test` trên `master`, ghi mốc.
2. **Đề xuất** người dùng tạo tag đánh dấu điểm quay về (agent không tự chạy): `git tag pre-postgresql`.
3. Ghi vào báo cáo: muốn quay lại SQL Server thì `git switch --detach pre-postgresql` và dùng lại `.env` cũ
   (người dùng đã có bản sao lưu biến môi trường ở `A:\Digi-Shop-env-backup`).
4. Kiểm tra máy người dùng đã có PostgreSQL chưa (dịch vụ `postgresql-x64-*` trong `Get-Service`). **Nếu chưa có thì
   dừng** và đưa hướng dẫn ở mục "Việc của người dùng trước giai đoạn P" bên dưới.
   - Trạng thái đã biết (2026-11-19): **PostgreSQL 17.12 đã cài ở `A:\postgre`**, dịch vụ `postgresql-x64-17` tự chạy,
     cổng 5432, có sẵn extension `unaccent` và ICU. `psql` **không có trong PATH**: gọi bằng
     `& "A:\postgre\bin\psql.exe" -U postgres -h localhost ...` (lệnh sẽ hỏi mật khẩu, chỉ người dùng gõ được).
   - Hai database `digishop` và `digishop_test` (UTF8) **đã được tạo**. Tag `pre-postgresql` **đã có** trên `master`.
   - `.env` **chưa** đổi sang PostgreSQL: agent đếm số dòng trên SQL Server trước (P-5), rồi mới hướng dẫn người dùng đổi.

### Việc của người dùng trước giai đoạn P (agent chỉ hướng dẫn, không tự làm)

1. Cài **PostgreSQL 17** bản Windows từ trang chính thức (postgresql.org, bộ cài EDB), giữ cổng **5432**, nhớ mật khẩu
   user `postgres`. Bộ cài có sẵn ICU và extension `unaccent`.
2. Tạo 2 database: `digishop` (chạy app) và `digishop_test` (bộ test DB thật, sẽ bị xoá và tạo lại liên tục).
3. **Chỉ khi agent báo đã đếm xong dữ liệu SQL Server** (trong giai đoạn P), mới sửa `.env`:
   **giữ nguyên các dòng SQL Server nhưng thêm dấu `#` phía trước** (để quay lại khi cần), rồi thêm theo
   `.env.example` mới mà giai đoạn P tạo ra:
   `DATABASE_URL=postgresql://postgres:<mật khẩu>@localhost:5432/digishop`,
   `TEST_DATABASE_URL=postgresql://postgres:<mật khẩu>@localhost:5432/digishop_test`, `DB_POOL_MAX=10`,
   `DB_SSL=false`.

---

## 3. Giai đoạn P: Chuyển sang PostgreSQL (nhánh `phase/p-postgresql`)

**Mục tiêu**: toàn bộ app chạy trên PostgreSQL với **hành vi y hệt** trên SQL Server. Không thêm tính năng.

**Nguyên tắc**: viết bộ test chạy trên DB thật **trước**, để chốt hành vi. Port xong, bộ test đó phải xanh trên PostgreSQL.

### P-1: Bộ test hợp đồng trên DB thật (viết trước, chạy trên PostgreSQL sau khi port)

**File được sửa**: `test-db/` (thư mục mới, toàn bộ), `test-db/helpers/reset-database.js` (mới), `package.json` (chỉ thêm
script `"test:db"`).

**Việc cần làm** (skill `tdd`):
1. Thư mục `test-db/` với hậu tố `.db-test.js`, để `npm test` (`node --test`) **không** tự chạy chúng (kiểm tra mẫu tên
   file mặc định của `node --test` trên Node 24; nếu vẫn bị nhặt thì mỗi file tự `skip` khi thiếu `TEST_DATABASE_URL`).
   Script: `"test:db": "node --test --test-concurrency=1 test-db/"`.
2. Helper reset: chạy `prisma migrate reset --force --skip-seed` (hoặc tương đương) **chỉ khi** `TEST_DATABASE_URL`
   có và tên DB kết thúc bằng `_test`; nếu không thì ném lỗi, không bao giờ đụng DB `digishop`. Tạo dữ liệu tối thiểu
   bằng Prisma.
3. Các file test (gọi qua **repository/service thật**, không dùng fake):
   - `concurrency.db-test.js`:
     - Hai checkout đồng thời tranh **1 sản phẩm cuối cùng**: đúng một đơn thành công, tồn kho = 0, không âm.
     - Hai đơn đồng thời dùng **lượt cuối của voucher**: đúng một đơn được giảm.
     - Hai lần thêm cùng biến thể vào giỏ cùng lúc: một dòng giỏ, số lượng cộng đúng.
     - Huỷ đơn: tồn kho và lượt voucher được trả **đúng một lần**.
     - Cộng/trừ điểm thưởng đồng thời: số dư đúng.
   - `search.db-test.js`:
     - `q=ban phim` khớp sản phẩm có "Bàn phím" (không dấu).
     - `q=KEYCHRON` khớp "Keychron" (không phân biệt hoa thường).
     - Tìm kiếm admin người dùng/đơn hàng/đánh giá không phân biệt hoa thường.
     - Sắp xếp theo tên tiếng Việt đúng thứ tự (Â, Ă, Đ...).
   - `constraints.db-test.js`: một đánh giá cho mỗi khách mỗi sản phẩm (partial unique), bình luận khách (`user_id`
     NULL) không bị chặn, các CHECK quan trọng (mã voucher 5 ký tự, brand hợp lệ, số lượng không âm) chặn đúng.
   - `dashboard.db-test.js`: đơn lúc 23:30 ngày 31/12 giờ Việt Nam thuộc năm cũ, 00:10 ngày 1/1 thuộc năm mới; chuỗi
     theo tháng không thiếu tháng trống; doanh thu, lợi nhuận khớp tính tay.
   - `schema.db-test.js`: `verifyDatabaseSchema` pass trên DB đã migrate, ném `SCHEMA_NOT_READY` trên DB trống.

**Tiêu chí hoàn thành**: bộ test chạy được bằng `npm run test:db` sau khi P-2..P-5 xong; mỗi test có tên tiếng Anh mô tả
hành vi; không test nào phụ thuộc thứ tự chạy.

### P-2: Schema Prisma và migration gốc cho PostgreSQL

**File được sửa**: `prisma/schema.prisma`, `prisma/migrations/` (toàn bộ), `prisma/migrations-sqlserver/` (mới, nơi lưu
bản cũ), `prisma.config.cjs` (chỉ nếu cần), `docs/specs/postgresql-migration.md` (mới).

**Việc cần làm**:
1. **Lưu trữ** 15 migration SQL Server: chuyển nguyên thư mục cũ sang `prisma/migrations-sqlserver/` (dùng `git mv`
   để giữ lịch sử), thêm `README.md` ngắn nói rõ đây là lịch sử, không còn chạy.
2. `schema.prisma`: `provider = "postgresql"`. Đổi kiểu, giữ nguyên tên bảng/cột (`@map`, `@@map`) và tên index/constraint
   (`map:`):
   - `@db.NVarChar(n)` → `@db.VarChar(n)`; `@db.NVarChar(Max)` → `@db.Text`.
   - `@db.DateTime2` → `@db.Timestamptz(3)`; `dbgenerated("SYSUTCDATETIME()")` → `now()`.
   - `@db.Decimal(p,s)` giữ nguyên; `@db.Char(n)` giữ nguyên; `@db.TinyInt` → `@db.SmallInt`.
   - Trường UUID dạng chuỗi giữ `VarChar(36)` để không đổi code.
3. Tạo migration gốc `prisma/migrations/20261120000000_postgresql_baseline/migration.sql`:
   - Bắt đầu bằng `CREATE EXTENSION IF NOT EXISTS unaccent;`.
   - Phần bảng/index sinh bằng `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (kiểm tra cú
     pháp lệnh đúng với Prisma 7.10.0).
   - **Viết tay thêm**, đối chiếu từng migration cũ để không sót:
     - Tất cả **34 CHECK constraint**, giữ nguyên tên. Dịch: `LEN(x)` → `char_length(x)`;
       `x NOT LIKE N'%[^A-Z0-9]%' COLLATE Latin1_General_BIN` → `x ~ '^[A-Z0-9]+$'`; ràng buộc kiểu "phone/tablet chỉ được
       phép khi `is_deleted = 1`" → `is_deleted = true`.
     - Mọi **filtered/partial unique index** → `CREATE UNIQUE INDEX ... WHERE ...` của PostgreSQL, cùng tên.
     - Hàm `immutable_unaccent(text)` (IMMUTABLE, gọi `public.unaccent('public.unaccent', $1)`) dùng cho tìm kiếm, và
       index biểu thức trên `lower(immutable_unaccent(name))` của `products`.
   - `migration_lock.toml`: `provider = "postgresql"`.
4. `docs/specs/postgresql-migration.md`: bảng ánh xạ kiểu, danh sách CHECK và partial index đã chuyển (tên cũ → tên mới,
   phải trùng), quyết định về collation (tìm kiếm dùng `unaccent` + `ILIKE`, sắp xếp tiếng Việt dùng ICU
   `COLLATE "vi-VN-x-icu"`), cách quay lại SQL Server.

**Tiêu chí hoàn thành**: `npx prisma validate` pass; `npx prisma migrate reset --force --skip-seed` trên `digishop_test`
chạy sạch; `npx prisma migrate diff` giữa DB vừa migrate và schema **không còn khác biệt**; số CHECK và partial index đếm
được bằng truy vấn `pg_constraint`/`pg_indexes` khớp bản cũ.

### P-3: Lớp kết nối DB

**File được sửa**: `src/db/config.js`, `src/db/prisma.js`, `src/server-lifecycle.js` (chỉ phần nhận diện lỗi DB),
`scripts/db/create-database.js`, `package.json` (dependencies), `.env.example`, `test/*` chỉ những file đang test
`config.js`/`prisma.js`/`server-lifecycle.js`.

**Phụ thuộc**: P-2.

**Việc cần làm**:
1. Dependencies: thêm `@prisma/adapter-pg@7.10.0` và `pg` (ghim bản chính xác ổn định mới nhất của v8). **Chưa gỡ**
   `mssql`, `@prisma/adapter-mssql` (seed còn dùng tới khi P-5 xong; gỡ ở P-5).
2. `config.js`: chỉ bắt buộc `DATABASE_URL` (phải bắt đầu bằng `postgresql://` hoặc `postgres://`); tuỳ chọn
   `DB_POOL_MAX` (mặc định 10), `DB_SSL` (`true`/`false`, mặc định `false`), `DB_CONNECT_TIMEOUT_MS`. Giữ class
   `DatabaseConfigError` và kiểu message.
3. `prisma.js`: dùng `PrismaPg` với pool `pg`. `verifyDatabaseSchema` truy vấn `information_schema.tables` với
   `table_schema = 'public'` và `_prisma_migrations` bằng `LIMIT 1`. **Đổi `REQUIRED_MIGRATION`** sang tên migration gốc
   mới. Giữ nguyên danh sách bảng bắt buộc và hành vi ném `DatabaseSchemaError`.
4. `server-lifecycle.js`: nhận diện lỗi kết nối PostgreSQL (`ECONNREFUSED`, `ENOTFOUND`, SQLSTATE `28P01` sai mật khẩu,
   `3D000` DB không tồn tại, `57P03`) thay cho mã `mssql`, giữ nguyên message tiếng Việt in ra.
5. `create-database.js`: tạo DB PostgreSQL nếu chưa có (kết nối DB `postgres`, `CREATE DATABASE` an toàn với tên đã
   kiểm tra bằng regex).
6. `.env.example`: bỏ các biến `DB_SERVER`..`DB_TRUST_SERVER_CERTIFICATE`, thêm `TEST_DATABASE_URL`, `DB_SSL`, ghi
   chú cho Neon (dùng chuỗi **pooled** cho app, chuỗi **direct** cho migrate).

**Tiêu chí hoàn thành**: `npm start` với `.env` PostgreSQL khởi động được, trả trang chủ; thiếu hoặc sai `DATABASE_URL`
báo lỗi rõ ràng như cũ; test của các file này xanh.

### P-4a: Port SQL viết tay có khoá dòng (giao dịch, tồn kho, tiền)

**File được sửa**: `src/repositories/cart.repository.js`, `src/repositories/checkout.repository.js`,
`src/repositories/order.repository.js`, `src/repositories/payment.repository.js`,
`src/repositories/loyalty.repository.js`, `src/repositories/voucher.repository.js`.

**Phụ thuộc**: P-2, P-3.

**Việc cần làm** (skill `tdd`, `diagnosing-bugs` khi cần):
1. Bỏ `[dbo].`, `[...]` → tên định danh thường hoặc `"..."`, `N'...'` → `'...'`.
2. Khoá dòng:
   - `WITH (UPDLOCK, ROWLOCK)` trên dòng đã tồn tại → `SELECT ... FOR UPDATE`.
   - `WITH (UPDLOCK, HOLDLOCK)` dùng để **chặn chèn trùng** khi dòng **có thể chưa tồn tại** (ví dụ dòng giỏ hàng,
     lượt dùng voucher): đọc kỹ ý đồ từng chỗ. Ưu tiên `INSERT ... ON CONFLICT (...) DO UPDATE` nếu có unique phù hợp;
     nếu không thì `SELECT pg_advisory_xact_lock(hashtext(<khoá nghiệp vụ>))` ở đầu giao dịch. Ghi comment giải thích
     ngắn ở mỗi chỗ.
   - Giữ **thứ tự khoá** như bản cũ để tránh deadlock.
3. `SYSUTCDATETIME()` → `now()`; `LEN()` → `char_length()`; `LIKE '%[^A-Za-z0-9]%'` → `!~ '^[A-Za-z0-9]+$'`;
   `OFFSET n ROWS FETCH NEXT m ROWS ONLY` → `LIMIT m OFFSET n`; tìm kiếm voucher dùng `ILIKE`.
4. Ép kiểu kết quả: `COUNT(*)` trên PostgreSQL trả `bigint` (Prisma đọc thành `BigInt`): ép `::int` trong SQL hoặc
   `Number(...)` để service nhận **number** như cũ.

**Tiêu chí hoàn thành**: `npm test` xanh không sửa test; `test-db/concurrency.db-test.js` xanh trên PostgreSQL.

### P-4b: Port SQL viết tay chỉ đọc (catalog, landing, dashboard, auth)

**File được sửa**: `src/repositories/product.repository.js`, `src/repositories/landing.repository.js`,
`src/repositories/admin-dashboard.repository.js`, `src/repositories/auth.repository.js`.

**Phụ thuộc**: P-2, P-3. Chạy song song với P-4a (không trùng file).

**Việc cần làm**:
1. Tìm kiếm sản phẩm: `CHARINDEX(q COLLATE ..._CI_AI, p.name COLLATE ..._CI_AI) > 0` →
   `lower(immutable_unaccent(p.name)) LIKE '%' || lower(immutable_unaccent(${q})) || '%'` (tương tự cho `description`).
   **Escape** `%`, `_`, `\` trong `q` trước khi ghép (bản cũ dùng `CHARINDEX` nên ký tự đặc biệt không có nghĩa
   wildcard; giữ đúng điều đó).
2. Sắp xếp theo tên: `COLLATE Vietnamese_100_CI_AS` → `COLLATE "vi-VN-x-icu"`. Nếu collation không có trên máy, dùng
   `"und-x-icu"` và ghi lại trong báo cáo.
3. `TOP (n)` → `LIMIT n`; `OFFSET/FETCH` → `LIMIT/OFFSET`; `CAST(x AS ...)` đổi sang kiểu PostgreSQL tương ứng.
4. Dashboard: thay `DATEFROMPARTS/DATEPART/DATEADD/DATEDIFF` bằng `date_trunc` và phép cộng `interval`, **giữ đúng cách
   tính múi giờ +7** của `src/services/admin-period.js` (cùng ranh giới ngày/tuần thứ Hai/tháng/quý/năm). Không sửa
   `admin-period.js`.
5. `auth.repository.js`: `SYSUTCDATETIME()` → `now()`.
6. Ép `COUNT`/`SUM` về `number` như P-4a.

**Tiêu chí hoàn thành**: `npm test` xanh không sửa test; `test-db/search.db-test.js` và `dashboard.db-test.js` xanh.

### P-4c: Truy vấn Prisma phụ thuộc collation

**File được sửa**: `src/repositories/admin-user.repository.js`, `src/repositories/order.repository.js`
(**chỉ** các dòng `contains` ~210–212, phối hợp với P-4a: giao việc này **sau** khi P-4a xong để tránh trùng file),
`src/services/product.service.js` (~347–348), `src/services/review.service.js` (~314–315).

**Việc cần làm**: thêm `mode: "insensitive"` vào từng `contains` dùng cho tìm kiếm. Không đổi gì khác.

**Tiêu chí hoàn thành**: `npm test` xanh; test DB tìm kiếm admin không phân biệt hoa thường xanh.

### P-5: Viết lại seed và test reset cho PostgreSQL, gỡ thư viện SQL Server

**File được sửa**: `prisma/seed.js`, `scripts/db/normalize-seed.js` (nếu có SQL), `test/store-reset.integration.test.js`,
`test/store-reset-rollback.integration.test.js`, `package.json` (gỡ `mssql`, `@prisma/adapter-mssql`).

**Phụ thuộc**: P-2, P-3. Có thể chạy song song với P-4a/P-4b.

**Việc cần làm**:
1. Viết lại `seed.js` bằng `pg` (tham số `$1, $2...`) hoặc Prisma, **giữ nguyên** mọi chế độ (`seed`, `reset`,
   `rollback-check`), giữ nguyên dữ liệu đầu ra (cùng id, cùng số dòng), giữ nguyên giao dịch bao trọn và rollback khi
   lỗi.
2. `OUTPUT INSERTED` → `RETURNING`; `SET IDENTITY_INSERT ... ON` + chèn id cố định → chèn id cố định rồi
   `SELECT setval(pg_get_serial_sequence('<bảng>', 'id'), (SELECT MAX(id) FROM <bảng>))` cho **mọi** bảng có id tự tăng
   bị chèn id cố định (không làm bước này thì lần tạo sản phẩm tiếp theo trong admin sẽ lỗi trùng khoá).
   `UPDLOCK/HOLDLOCK` trong seed → `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` hoặc advisory lock tương đương.
3. Test reset: đổi chuỗi kết nối giả sang `postgresql://...`, bỏ `require("mssql")`, giữ nguyên các khẳng định hành vi.
4. Gỡ `mssql` và `@prisma/adapter-mssql` khỏi `package.json` **sau khi** grep toàn repo (trừ `prisma/migrations-sqlserver/`)
   không còn chỗ nào dùng.

**Tiêu chí hoàn thành**: trên `digishop`: `npm run db:migrate`, `npm run db:generate`, `npm run db:reset:local` thành công;
số dòng từng bảng chính (products, product_variants, product_images, users, orders, order_items, vouchers,
product_reviews) khớp với SQL Server (agent chính đếm trên SQL Server **trước** khi đổi `.env`, bằng truy vấn chỉ đọc);
tạo sản phẩm mới trong admin không lỗi khoá; `npm test` xanh.

### Sóng giao việc giai đoạn P

| Sóng | Việc | Ghi chú |
|---|---|---|
| 1 | P-1, P-2 | P-1 chỉ viết test, chưa chạy được |
| 2 | P-3 | Cần schema P-2 |
| 3 | P-4a, P-4b, P-5 | Không trùng file |
| 4 | P-4c | Sau P-4a (cùng `order.repository.js`) |

### Kiểm tra cuối giai đoạn P (agent chính)

- `npm test` xanh, **số test ≥ mốc**; `npm run test:db` xanh.
- `grep -rnE "UPDLOCK|HOLDLOCK|ROWLOCK|SYSUTCDATETIME|\[dbo\]|N'|TOP \(|DATEFROMPARTS|CHARINDEX|COLLATE Latin|mssql" src prisma scripts test test-support --include=*.js`
  không còn kết quả (ngoài `prisma/migrations-sqlserver/`).
- Trình duyệt (PORT=3100) với DB `digishop` đã seed, chạy hết các luồng:
  1. Trang chủ, catalog, lọc giá/hãng/đánh giá, tìm "ban phim", "KEYCHRON", "k2", phân trang.
  2. Chi tiết sản phẩm, chọn biến thể, gallery ảnh, đánh giá realtime (2 tab).
  3. Khách vãng lai: thêm giỏ, checkout 3 bước, COD → đặt thành công, nhận tài khoản tự tạo.
  4. Đăng nhập email và username, quên mật khẩu (nếu SMTP cấu hình), đổi địa chỉ.
  5. Khách đăng nhập: dùng voucher, dùng điểm, đặt đơn, xem "Đơn của tôi", chấm sao.
  6. MoMo/VNPay sandbox: tạo thanh toán, quay về, trạng thái đúng (nếu sandbox khả dụng).
  7. Admin: dashboard, danh sách đơn (lọc ngày, phân trang, đổi trạng thái, huỷ trả kho), sản phẩm (tạo, sửa, tải ảnh,
     xoá mềm), người dùng (khoá), voucher (tạo, sửa), đánh giá (ẩn/hiện).

### CỔNG DỪNG P

Báo cáo + đề xuất commit, rồi **dừng**. Nhắc người dùng **tự chạy lại các luồng trên ở cổng 3000** với `.env` mới trước
khi cho phép sang Sprint 3. Commit gợi ý:
- `test(db): add contract tests that run against a real database`
- `refactor(db): move the schema and migrations to postgresql`
- `refactor(db): connect through the prisma postgresql adapter`
- `refactor(shop): port locking queries for cart, checkout, orders, payments, loyalty and vouchers to postgresql`
- `refactor(catalog): port search, landing and dashboard queries to postgresql`
- `fix(admin): keep admin searches case-insensitive on postgresql`
- `refactor(seed): seed and reset the store on postgresql`

---

## 4. Lưu ý chung cho Sprint 3, 4, 5 sau khi đã chuyển sang PostgreSQL

- Mọi migration mới viết bằng cú pháp **PostgreSQL**, append-only sau migration gốc.
- Mọi việc có SQL viết tay phải có thêm test trong `test-db/` và chạy `npm run test:db`.
- Mỗi cổng dừng, `npm test` **và** `npm run test:db` đều xanh.

## 5. Sprint 3 (nhánh `sprint/03-categories-catalog-data`)

Dùng nguyên **mục 2 của `docs/sprints/sprint-03-05.prompt.md`** (S3-A..S3-F, sóng giao việc, checklist trình duyệt),
với các điều chỉnh sau:
- **S3-B**: migration viết cho PostgreSQL. Backfill `category_id` bằng `UPDATE products p SET category_id = c.id FROM
  categories c WHERE c.slug = p.device_type`. Drop constraint `products_device_type_check` bằng
  `ALTER TABLE ... DROP CONSTRAINT`. Thêm test vào `test-db/constraints.db-test.js` (FK, slug unique trong hàng chưa xoá
  bằng partial unique index).
- **S3-C**: lọc theo thẻ dùng `EXISTS (SELECT 1 FROM product_tags ...)` trong truy vấn catalog đã port ở P-4b; giữ cách
  tìm `unaccent` của P-4b.
- **S3-F**: seed thêm sản phẩm qua `seed.js` bản PostgreSQL, nhớ `setval` sau khi chèn id cố định.
- **CỔNG DỪNG 3**: người dùng test catalog, phân trang `/danh-muc/keyboard` và `/danh-muc/mouse`, ảnh mới, admin danh mục
  và thẻ trên máy.

## 6. Sprint 4 (nhánh `sprint/04-demo-data-dashboard`)

Dùng nguyên **mục 3 của `docs/sprints/sprint-03-05.prompt.md`** (S4-A..S4-C), với các điều chỉnh sau:
- **S4-A**: seed ~600–900 đơn phải chèn theo lô (multi-row `INSERT` hoặc `createMany`), seed trọn bộ dưới ~60 giây trên
  PostgreSQL local.
- **S4-B**: các test ranh giới thời gian đặt trong `test-db/dashboard.db-test.js` (chạy trên DB thật), không chỉ test fake.
- **CỔNG DỪNG 4**: người dùng xem dashboard với dữ liệu 2 năm trên máy.

---

## 7. Sprint 5: Stateless, nhiều instance, Cloudinary (nhánh `sprint/05-scaling-cloudinary`)

**Mục tiêu**: app chạy đúng khi có **nhiều instance cùng lúc** dùng chung một PostgreSQL, ảnh tải lên không phụ thuộc ổ
đĩa của instance, và **chứng minh được ngay trên máy** bằng một cụm 3 tiến trình + load balancer. Không có Redis.

### Thiết kế đã chốt

- **Rate limit dùng chung**: bảng `rate_limit_buckets (key varchar(200) PK, count int, expires_at timestamptz)`. Mỗi lần
  đếm: `INSERT ... ON CONFLICT (key) DO UPDATE SET count = CASE WHEN expires_at <= now() THEN 1 ELSE count + 1 END,
  expires_at = CASE WHEN expires_at <= now() THEN now() + interval ELSE expires_at END RETURNING count`. Dọn dòng hết hạn
  định kỳ. Store bộ nhớ hiện có giữ làm bản mặc định cho test; chọn store qua `RATE_LIMIT_STORE=memory|database`
  (mặc định `database` khi chạy app, `memory` trong test).
  DB lỗi khi đếm: **cho qua và ghi log** (fail-open) để sự cố DB không khoá đăng nhập của mọi người; ghi rõ quyết định
  trong comment.
- **Realtime đánh giá chéo instance**: bảng `review_events (id bigserial PK, product_id int, payload jsonb, created_at
  timestamptz default now())`. Thay đổi đánh giá công khai → ghi một dòng sự kiện. Mỗi instance **chỉ khi đang có ít nhất
  1 websocket** mới đọc `review_events WHERE id > lastSeenId` mỗi ~1,5 giây và phát cho client cục bộ. Không có người xem
  thì không đọc (để Neon được ngủ). Instance ghi sự kiện **không** phát trùng (đánh dấu theo `instanceId`). Xoá sự kiện
  cũ hơn 1 giờ định kỳ. Biến `REVIEW_EVENTS_MODE=direct|database` (mặc định `database` khi chạy app, `direct` trong test).
  Không dùng `LISTEN/NOTIFY`: cần kết nối trực tiếp giữ mở liên tục, làm DB Neon không ngủ được.
- **Websocket tiết kiệm**: phía trình duyệt đóng kết nối khi tab bị ẩn quá 2 phút, mở lại và tải lại danh sách khi tab
  hiện lại (dựa trên code `visibilitychange` đã có trong `public/js/review-live.js`).
- **Worker hết hạn thanh toán**: mỗi lượt chạy trong một giao dịch, đầu giao dịch gọi
  `pg_try_advisory_xact_lock(<hằng số>)`; không lấy được khoá thì bỏ qua lượt đó.
- **Định danh instance**: `INSTANCE_ID` = biến `K_REVISION` + một chuỗi ngẫu nhiên lúc khởi động trên Cloud Run, hoặc
  `<hostname>:<PORT>` trên máy. Mọi phản hồi có header `X-Instance`.
- **`GET /healthz`**: `200 { status: "ok", db: "ok", instance }`; DB không phản hồi trong 2 giây → `503`.
  Không lộ thông tin nhạy cảm.
- **Lưu ảnh**: `PRODUCT_IMAGE_STORAGE=local|cloudinary` (mặc định `local`). Bản `cloudinary` dùng `CLOUDINARY_URL`, thư mục
  `digishop/products`, `public_id` = UUID, URL trả về là `secure_url` của Cloudinary. Xoá ảnh khi admin bỏ ảnh: chỉ xoá
  ảnh **do app tải lên** (UUID trong thư mục `digishop/products`), không bao giờ xoá ảnh mẫu. Ảnh mẫu của seed vẫn ở
  `/uploads/products/<tên file>` từ thư mục trong bản build.
- **Cụm local để chứng minh**: `npm run cluster` bật 3 tiến trình app (cổng 3101–3103, `INSTANCE_ID` khác nhau, cùng
  `DATABASE_URL`) và một load balancer viết bằng Node ở cổng 8080 (round-robin, hỗ trợ websocket, gửi
  `X-Forwarded-For`). Chỉ dùng để chứng minh và test local, **không** dùng khi deploy (Cloud Run có load balancer riêng).

### S5-A: Rate limit dùng chung

**File được sửa**: `prisma/schema.prisma` (thêm model), `prisma/migrations/<ts>_rate_limit_buckets/migration.sql` (mới),
`src/middlewares/auth.js` (chỉ phần `rateBuckets` và `rateLimitAuth`), `src/infra/rate-limit-store.js` (mới),
`test/rate-limit-store.test.js` (mới), `test-db/rate-limit.db-test.js` (mới), `.env.example`.

**Việc cần làm** (skill `tdd`): tách interface `{ hit(key, windowMs) → Promise<count> }`, hai bản cài đặt như thiết kế.
Giữ nguyên `RATE_LIMITS`, khoá theo IP và identifier, mã lỗi, header trả về.

**Tiêu chí hoàn thành**: mọi test rate limit cũ xanh với store bộ nhớ; test DB chứng minh 2 client Prisma riêng (mô phỏng
2 instance) cùng đếm vào một bucket; vượt ngưỡng ở instance này thì instance kia cũng chặn.

### S5-B: Realtime đánh giá qua bảng sự kiện

**File được sửa**: `prisma/schema.prisma`, `prisma/migrations/<ts>_review_events/migration.sql` (mới),
`src/realtime/review-hub.js`, `src/realtime/review-events.js` (mới), `src/services/review.service.js` (**chỉ** điểm gọi
broadcast), `public/js/review-live.js` (chỉ phần đóng khi ẩn tab lâu), `test/review-realtime.integration.test.js`,
`test-db/review-events.db-test.js` (mới).

**Phụ thuộc**: S5-A xong (cùng `schema.prisma`, giao tuần tự).

**Việc cần làm** (skill `tdd`): bus có 2 bản (`direct` giữ hành vi hiện tại, `database` như thiết kế). Vòng đọc dừng khi
không còn socket, chạy lại khi có socket mới. Payload giữ nguyên định dạng client đang nhận.

**Tiêu chí hoàn thành**: test realtime cũ xanh; test DB với 2 hub (2 client Prisma) chứng minh đánh giá tạo ở hub A tới
client của hub B trong ≤ 3 giây và không phát trùng ở A; không có socket thì không có truy vấn nào tới `review_events`.

### S5-C: Worker hết hạn thanh toán chạy ở một nơi

**File được sửa**: `src/services/payment-expiration.worker.js`, `src/repositories/payment.repository.js` (chỉ thêm hàm lấy
khoá nếu cần), `test/payment-expiration*.test.js` (hiện có hoặc mới), `test-db/payment-worker.db-test.js` (mới).

**Phụ thuộc**: không (chạy song song với S5-A).

**Tiêu chí hoàn thành**: test DB chạy 2 worker đồng thời, chỉ một bên xử lý đơn quá hạn; mỗi đơn chỉ được trả kho và
voucher một lần; hành vi một instance không đổi.

### S5-D: Cloudinary cho ảnh tải lên

**File được sửa**: `src/services/product-image-storage.js`, `src/services/product-image-storage/` (thư mục mới nếu tách
`local.js` và `cloudinary.js`), `src/controllers/admin.controller.js` (**chỉ** nếu chỗ gọi lưu/xoá ảnh cần đổi chữ ký;
hạn chế tối đa), `test/product-image-upload.integration.test.js`, `test/product-image-storage.test.js` (mới),
`package.json` (thêm `cloudinary` bản chính xác, hoặc gọi REST API ký bằng `crypto` nếu muốn tránh thêm thư viện),
`.env.example`.

**Phụ thuộc**: không.

**Việc cần làm** (skill `tdd`):
1. Giữ nguyên export `saveProductImage`, `removeProductImage`, `uploadedImageFromPublicPath`, `storageDirectory`.
   `uploadedImageFromPublicPath` nhận thêm URL Cloudinary đúng định dạng của app; mọi URL khác trả `null`.
2. Ảnh vẫn được `sharp` xử lý như cũ **trước** khi tải lên.
3. Test bản Cloudinary bằng fake HTTP/SDK, **không gọi mạng thật** trong `npm test`.
4. Nếu trang có Content-Security-Policy cho ảnh, thêm `https://res.cloudinary.com` (hiện chưa thấy CSP; kiểm tra lại).

**Tiêu chí hoàn thành**: `PRODUCT_IMAGE_STORAGE=local` chạy y hệt hiện nay; test bản Cloudinary xanh. Chưa cần tài khoản
Cloudinary thật ở sprint này.

### S5-E: Healthz, X-Instance, cụm local và tài liệu scaling

**File được sửa**: `src/app.js` (chỉ thêm middleware `X-Instance` và mount route health), `src/routes/health.routes.js`
(mới), `src/infra/instance.js` (mới), `scripts/cluster/start-cluster.js` (mới), `scripts/cluster/load-balancer.js` (mới),
`scripts/cluster/smoke.js` (mới: gọi `/healthz` 30 lần qua cổng 8080, in số lần mỗi instance), `package.json` (script
`"cluster"`, `"cluster:smoke"`; thêm `http-proxy` bản chính xác nếu dùng), `docs/scaling.md` (mới, tiếng Việt),
`test/health.integration.test.js` (mới).

**Phụ thuộc**: S5-A, S5-B, S5-C xong.

**Việc cần làm**:
1. `start-cluster.js`: bật 3 tiến trình con với `PORT` và `INSTANCE_ID` riêng, `RATE_LIMIT_STORE=database`,
   `REVIEW_EVENTS_MODE=database`; Ctrl+C tắt sạch cả 4 tiến trình; một tiến trình con chết thì in rõ, không kéo sập cả cụm.
2. `load-balancer.js`: round-robin, bỏ qua instance không trả `/healthz` (kiểm tra mỗi 5 giây), proxy websocket.
3. `docs/scaling.md`: sơ đồ kiến trúc (trình duyệt → load balancer → 3 instance → PostgreSQL, Cloudinary), từng nguồn
   trạng thái đã xử lý thế nào và vì sao, cách chạy cụm local, cách chứng minh (smoke, realtime chéo instance, tắt một
   instance web vẫn chạy), phần dành cho Cloud Run (điền ở giai đoạn D), chỗ chèn ảnh chụp minh chứng.

**Tiêu chí hoàn thành**: `npm run cluster` + `npm run cluster:smoke` thấy cả 3 instance nhận request; test health xanh.

### Sóng giao việc Sprint 5

| Sóng | Việc | Ghi chú |
|---|---|---|
| 1 | S5-A, S5-C, S5-D | Không trùng file (S5-A sửa `schema.prisma`, S5-C/S5-D không) |
| 2 | S5-B | Sau S5-A (cùng `schema.prisma`) |
| 3 | S5-E | Sau S5-A, S5-B, S5-C |

### Kiểm tra cuối Sprint 5 (agent chính)

1. Chạy đơn lẻ `npm start` (PORT=3100): mọi luồng ở checklist giai đoạn P vẫn chạy.
2. `npm run cluster`, mở `http://localhost:8080`:
   - `npm run cluster:smoke`: 3 instance đều nhận request.
   - 2 tab cùng sản phẩm (kiểm tra `X-Instance` khác nhau trong DevTools), đánh giá ở tab 1, tab 2 thấy trong ≤ 3 giây.
   - Đăng nhập sai liên tục: bị chặn ở đúng ngưỡng dù request rải qua 3 instance.
   - Tắt một instance: web vẫn chạy, load balancer bỏ qua nó.
   - Tạo đơn MoMo/VNPay rồi bỏ ngang: chỉ một instance xử lý hết hạn (xem log).
3. Tải ảnh sản phẩm ở chế độ `local` vẫn chạy.

### CỔNG DỪNG 5 (cổng cuối trước deploy)

Báo cáo + đề xuất commit, rồi **dừng hẳn**. Trong báo cáo, ghi rõ cho người dùng:

> **Đây là lúc bạn test toàn bộ trên máy.** Hãy chạy cả chế độ đơn lẻ (`npm start`) lẫn cụm (`npm run cluster`) theo
> checklist trên. Khi nào bạn hài lòng và đã commit, nhắn **"bắt đầu deploy"** thì giai đoạn D mới được bắt đầu.

Commit gợi ý:
- `feat(auth): share rate limits across instances through the database`
- `feat(review): deliver realtime review updates across instances`
- `fix(payment): run payment expiration on one instance at a time`
- `feat(admin): store uploaded product photos on cloudinary when configured`
- `feat(infra): health check, instance header and a local three-instance cluster`

---

## 8. Giai đoạn D: Deploy lên Cloud Run + Neon + Cloudinary (nhánh `phase/d-cloud-run`)

> **Chỉ bắt đầu khi người dùng đã nhắn "bắt đầu deploy".** Agent chính kiểm tra lại câu đó có trong hội thoại.
> Nếu không có thì dừng.

### Phân vai rõ ràng

| Việc | Ai làm |
|---|---|
| Tạo tài khoản Google Cloud, gắn thẻ, nâng tài khoản trả phí, tạo project, bật API | **Người dùng** |
| Cài Google Cloud CLI (`gcloud`), đăng nhập (`gcloud auth login`) | **Người dùng** |
| Tạo tài khoản Neon, project, lấy 2 chuỗi kết nối (pooled, direct) | **Người dùng** |
| Tạo tài khoản Cloudinary, lấy `CLOUDINARY_URL` | **Người dùng** |
| Điền mọi giá trị bí mật vào file `deploy/cloud-run.env.yaml` (đã gitignore) | **Người dùng** |
| Cấu hình URL trả về MoMo/VNPay sandbox, origin Google OAuth trong console tương ứng | **Người dùng** (agent đưa giá trị cần điền) |
| Viết file cấu hình, script, tài liệu, sửa code nhỏ cho môi trường cloud | Agent (qua subagent) |
| Chạy lệnh `gcloud ...` deploy, migrate lên Neon | **Người dùng tự chạy** theo hướng dẫn, hoặc agent chạy **từng lệnh sau khi người dùng đồng ý từng lệnh** |

Agent **không bao giờ** đọc, in hoặc chép nội dung `deploy/cloud-run.env.yaml` hay chuỗi kết nối Neon.

### D-1: Chuẩn bị bản build cho Cloud Run

**File được sửa**: `Dockerfile` (mới; Cloud Build dùng để đóng gói trên cloud, **máy người dùng không cần Docker**),
`.dockerignore` (mới), `.gcloudignore` (mới), `.gitignore` (thêm `deploy/*.env.yaml`), `package.json` (chỉ thêm
`"engines": { "node": "24.x" }` nếu chưa có).

**Việc cần làm**:
1. `Dockerfile` nhiều tầng từ `node:24-slim` (khớp Node trên máy): `npm ci --omit=dev`, `npx prisma generate`, chép
   `src/`, `public/`, `prisma/`, `data/product-images/` (ảnh mẫu), chạy bằng user không phải root, `CMD ["node",
   "server.js"]`, lắng nghe `PORT` do Cloud Run cấp.
2. `.dockerignore`/`.gcloudignore`: loại `.env`, `deploy/*.env.yaml`, `node_modules`, `.git`, `test`, `test-db`, `docs`,
   `prisma/migrations-sqlserver`.

**Tiêu chí hoàn thành**: không file bí mật nào lọt vào bản build (kiểm tra danh sách bằng
`gcloud meta list-files-for-upload` do **người dùng** chạy, hoặc đọc kỹ file ignore).

### D-2: Cấu hình và script deploy

**File được sửa**: `deploy/cloud-run.env.example.yaml` (mới, chỉ khoá và giá trị mẫu), `deploy/deploy.ps1` (mới),
`deploy/migrate-neon.ps1` (mới), `docs/deploy.md` (mới, tiếng Việt).

**Việc cần làm**:
1. `cloud-run.env.example.yaml`: đủ mọi biến app cần trên cloud: `DATABASE_URL` (Neon **pooled**, `sslmode=require`),
   `DB_SSL=true`, `DB_POOL_MAX` nhỏ (ví dụ 5), `JWT_ACCESS_SECRET`, `APP_ORIGIN` (URL Cloud Run), `TRUST_PROXY=1`,
   `PAYMENT_ENV=sandbox`, khoá MoMo/VNPay sandbox, `GOOGLE_CLIENT_ID`, SMTP, `ADMIN_DEFAULT_PASSWORD`,
   `PRODUCT_IMAGE_STORAGE=cloudinary`, `CLOUDINARY_URL`, `RATE_LIMIT_STORE=database`, `REVIEW_EVENTS_MODE=database`,
   `ADMIN_EXTRAS`.
2. `deploy.ps1` (PowerShell 5.1, không `&&`): kiểm tra file `deploy/cloud-run.env.yaml` tồn tại, rồi
   `gcloud run deploy digishop --source . --region asia-southeast1 --allow-unauthenticated --env-vars-file
   deploy/cloud-run.env.yaml --min-instances 0 --max-instances 3 --concurrency 20 --cpu 1 --memory 512Mi --timeout 3600
   --no-session-affinity` (CPU chỉ cấp khi có request là mặc định; kiểm tra lại cờ đúng với phiên bản gcloud hiện hành).
3. `migrate-neon.ps1`: đọc chuỗi **direct** của Neon từ biến môi trường do người dùng đặt trong phiên PowerShell (không
   ghi vào file), chạy `npx prisma migrate deploy`, sau đó `node prisma/seed.js` **chỉ khi** người dùng truyền tham số
   `-Seed`.
4. `docs/deploy.md`: từng bước cho người dùng, theo thứ tự:
   1. Tạo project Google Cloud, bật Cloud Run, Cloud Build, Artifact Registry.
   2. **Đặt cảnh báo ngân sách 1 USD.**
   3. Tạo Neon project (vùng Singapore), lấy chuỗi pooled và direct.
   4. Tạo Cloudinary, lấy `CLOUDINARY_URL`.
   5. Chép `cloud-run.env.example.yaml` thành `cloud-run.env.yaml`, điền giá trị.
   6. Chạy `migrate-neon.ps1 -Seed`.
   7. Chạy `deploy.ps1`.
   8. Lấy URL dịch vụ, cập nhật `APP_ORIGIN`, deploy lại.
   9. Thêm URL vào Google OAuth (Authorized JavaScript origins) và cấu hình URL trả về/IPN MoMo, VNPay sandbox.
   10. Đặt **quy tắc dọn image cũ** trong Artifact Registry (giữ 2 bản mới nhất).
   11. Mở link một lần trước buổi chấm để app và DB "dậy" sẵn.
   12. Sau khi chấm: đổi mật khẩu admin, tạo tài khoản demo chỉ quyền khách hàng cho CV.

**Tiêu chí hoàn thành**: một người chưa biết dự án làm theo `docs/deploy.md` từ đầu tới cuối được; không file nào
trong git chứa bí mật.

### D-3: Bằng chứng scaling trên Cloud Run

**File được sửa**: `scripts/cluster/cloud-smoke.js` (mới: gửi N request song song tới URL truyền vào, gom header
`X-Instance`, in bảng đếm), `docs/scaling.md` (điền phần Cloud Run), `package.json` (script `"cloud:smoke"`).

**Việc cần làm**: hướng dẫn tạm hạ `--concurrency` xuống 1–2 khi quay video để Cloud Run bật đủ nhiều instance, chạy
`cloud:smoke` thấy ≥ 2 instance, demo realtime chéo instance, rồi khôi phục `--concurrency 20`. Ghi chú ảnh chụp cần
lấy: trang Metrics "Instance count" của Cloud Run, kết quả `cloud:smoke`, 2 tab realtime.

### Kiểm tra cuối giai đoạn D (cùng người dùng)

1. URL Cloud Run mở được trang chủ; `/healthz` trả `ok`.
2. Lặp lại checklist giai đoạn P trên URL thật (MoMo/VNPay sandbox, Google login, email).
3. Tải ảnh sản phẩm trong admin, ảnh nằm trên Cloudinary và vẫn hiện sau khi deploy lại.
4. `cloud:smoke` thấy nhiều instance; realtime chéo instance chạy.
5. Kiểm tra trang Billing: chi phí 0 hoặc gần 0.

### CỔNG DỪNG D

Báo cáo + đề xuất commit. Gợi ý:
- `build(deploy): container build for cloud run`
- `docs(deploy): step-by-step cloud run, neon and cloudinary setup`
- `feat(infra): smoke test that shows load balancing across cloud run instances`

---

## 9. Review tổng (agent chính, trước mỗi cổng dừng)

1. Chạy skill `code-review` trên toàn bộ diff của giai đoạn.
2. Kiểm tra tay:
   - `git status`: chỉ có file thuộc giai đoạn (cộng `package-lock.json` khi được phép, `docs/sprints/` sẵn có).
   - **Không có thay đổi ngoài danh sách file của các việc** đã giao. Có thì hỏi lý do, hoàn tác nếu không cần.
   - Không còn cú pháp SQL Server (từ giai đoạn P trở đi).
   - Mọi chỗ render dữ liệu dùng `escapeHtml` hoặc `textContent`.
   - Không có bí mật, `.env`, chuỗi kết nối thật trong diff.
   - Migration mới chạy được trên DB đã có dữ liệu **và** trên DB trắng.
3. `npm test` và `npm run test:db`: số pass ≥ mốc đầu giai đoạn, 0 fail.

## 10. Báo cáo cuối mỗi giai đoạn

Bằng tiếng Việt:
1. Tóm tắt theo từng việc (P-1, S3-A...): file chính, quyết định đáng chú ý.
2. Kết quả test (mốc trước/sau), kết quả kiểm tra trình duyệt, **phần chưa kiểm tra được và lý do**.
3. **Việc người dùng cần làm** trước khi sang giai đoạn sau (đổi `.env`, chạy migrate, test các luồng nào).
4. Đề xuất commit theo nhóm file: mỗi commit một lệnh `git add` trên **một dòng** và message theo quy ước, kết thúc bằng
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
5. **Dừng, chờ người dùng.** Không commit, không push, không sang giai đoạn sau khi chưa được đồng ý.
