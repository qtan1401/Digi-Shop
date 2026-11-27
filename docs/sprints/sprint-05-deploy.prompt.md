# Sprint 5 (stateless, nhiều instance, Cloudinary) + Giai đoạn D (Cloud Run): prompt cho agent chính

> File này là **prompt điều phối**, thay cho mục 7 và 8 của `docs/sprints/postgres-s3-s5-deploy.prompt.md`
> (mục 0 "Ràng buộc an toàn", "Quy tắc cách ly", mục 1 "Quy trình điều phối", mục 9, 10 của file đó **vẫn áp dụng**:
> đọc chúng trước). Agent chính chia việc cho **subagent**, tự review, chạy test, kiểm tra trình duyệt, rồi
> **chỉ đề xuất** commit.
>
> Thứ tự: **Bước 0 → Sprint 5 → CỔNG DỪNG 5 → (chờ người dùng nói "bắt đầu deploy") → Giai đoạn D → CỔNG DỪNG D**.
>
> **Giai đoạn D chỉ bắt đầu khi người dùng đã test local xong và nhắn đúng câu "bắt đầu deploy".**
> Trước đó: không tạo tài khoản, không chạy `gcloud`, không đụng Neon hay Cloudinary thật.

---

## 0. Trạng thái hiện tại (đã kiểm tra ngày 2026-11-20)

- `master` = `origin/master` = `7cac967`: giai đoạn P (PostgreSQL) và **Sprint 3 + 4 đã commit và push**
  (`7cac967 feat(sprints): complete catalog and dashboard delivery`). Working tree sạch (chỉ có `docs/sprints/` chưa theo
  dõi). Đã kiểm chứng:
  - `npm test`: 422 test, 416 pass, 0 fail, 6 skip.
  - DB `digishop`: 42 sản phẩm (bàn phím 14, chuột 14, laptop 5, màn hình 4, tai nghe 3, SSD 2), 7 thẻ đều ≥ 10 sản phẩm,
    777 đơn từ 2024-11-01 đến 2026-11-19 (đủ 25 tháng; doanh thu 2025 ≈ 2,75 tỷ, 2026 ≈ 3,28 tỷ), 61 người dùng,
    220 đánh giá, mọi sản phẩm có ≥ 2 ảnh gallery + ảnh chính.
  - `/danh-muc/keyboard?page=2`, `/danh-muc/mouse?page=2` có dữ liệu; `/the/apple` → 301 `/hang/apple`; `/the/gaming`,
    `/sitemap.xml`, `/api/catalog/taxonomy` chạy; tìm "ban phim" ra 18 kết quả.
  - Ảnh seed: 184 file đều 1200×1200 nền trắng.
- **Chưa kiểm chứng**: `npm run test:db` (xem lưu ý Prisma bên dưới); màn admin "Danh mục & thẻ" và dashboard trên trình
  duyệt; checkout 3 bước trên trình duyệt.
- **Việc dọn nhỏ còn lại của Sprint 3** (làm ở bước 0, không cần subagent):
  - 9 file tên UUID trong `data/product-images/` (ngày 19–20/11) là ảnh tải lên lúc thử admin, đã bị `.gitignore` bỏ qua.
    Không commit; báo người dùng có thể xoá.
  - `data/product-images/SOURCES.md` còn nhắc `404-black.png` (file đã bỏ, seed không dùng): xoá phần đó khỏi dòng 404.
  - Hai ảnh gallery `402-gallery-1.png`, `402-gallery-2.png` vẫn nền xám kèm phụ kiện: **ghi vào báo cáo**, không bắt buộc sửa.

### Lưu ý: Prisma chặn lệnh xoá DB khi chạy từ agent

`npm run test:db` gọi `prisma migrate reset --force`. Prisma 7 phát hiện một số agent AI và **từ chối** lệnh này nếu không
có biến `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` chứa nguyên văn lời đồng ý của người dùng.
- **Không tự đặt biến này.** Nếu bị chặn: dừng, nhờ người dùng tự chạy `npm run test:db` trong terminal của họ và gửi
  kết quả, hoặc xin người dùng một câu đồng ý rõ ràng cho đúng DB `digishop_test` rồi mới dùng.
- Trong báo cáo, ghi rõ `test:db` do ai chạy và kết quả ra sao.

### Hiện trạng code liên quan Sprint 5 (dòng có thể lệch vài dòng)

| Thành phần | Vị trí | Vấn đề khi chạy nhiều instance |
|---|---|---|
| Rate limit | `src/middlewares/auth.js:34` `rateBuckets = new Map()`, `rateLimitAuth` ~68, chính sách `RATE_LIMITS` ~35–48 (login, resend, recover, reset, `guestReview`) | Mỗi instance đếm riêng |
| Realtime đánh giá | `src/realtime/review-hub.js` (`createReviewHub` ~38, `attach` ~115, export singleton ~168); gọi từ `src/services/review.service.js` ~111–115: **chỉ publish khi chính instance đó có subscriber** (`hasSubscribers`) | Người xem ở instance khác không nhận được |
| Worker hết hạn thanh toán | `src/services/payment-expiration.worker.js` (`startPaymentExpirationWorker`, mặc định **10 giây** một lượt, `setInterval` ~24); bật trong `src/server-lifecycle.js` | Mọi instance cùng xử lý |
| Ảnh tải lên | `src/services/product-image-storage.js` (4 export); `src/app.js:35` phục vụ `/uploads/products`; `src/controllers/admin.controller.js` gọi `saveProductImage` (~49, ~88, ~110), `removeProductImage`, `uploadedImageFromPublicPath` (~241) | Ổ đĩa không dùng chung, bị xoá khi container khởi động lại |
| Proxy | `src/app.js:27` `trust proxy` theo `TRUST_PROXY` | Cần `TRUST_PROXY=1` trên Cloud Run |
| Tắt máy | `src/server-lifecycle.js` đã xử lý `SIGTERM`/`SIGINT` | Cloud Run gửi `SIGTERM`: đã ổn |
| Cookie | `secure` tự bật khi mọi `APP_ORIGIN` là `https://` (`src/auth/config.js:78`) | Ổn trên Cloud Run |
| `/healthz` | Chưa có (trả 404) | Cần thêm |
| Cảnh báo | Server in `DEP0169 url.parse()` lúc khởi động | Không ảnh hưởng; tìm nguồn và ghi vào báo cáo, chỉ sửa nếu nằm trong code của repo |

Biến môi trường app đang đọc: `DATABASE_URL`, `DB_POOL_MAX`, `DB_SSL`, `DB_CONNECT_TIMEOUT_MS`, `APP_ORIGIN`,
`TRUST_PROXY`, `PAYMENT_ENV`, `MOMO_*`, `VNPAY_*`, `PRODUCT_IMAGE_STORAGE_DIR`, `ADMIN_EXTRAS`, cùng các biến bắt buộc
trong `src/auth/config.js` (JWT, Google, SMTP, mật khẩu admin mặc định). Danh sách đầy đủ ở `.env.example`.

---

## 1. Bước 0: Chuẩn bị (agent chính, không cần subagent, không dừng nếu mọi thứ ổn)

1. `git switch master`, `git pull --ff-only`, xác nhận HEAD là `7cac967` hoặc mới hơn, working tree sạch.
2. `npm test` để chốt mốc (hiện 422 test, 416 pass, 0 fail). Nhờ người dùng chạy `npm run test:db` nếu bị Prisma chặn.
3. Liệt kê 9 file UUID trong `data/product-images/` để người dùng tự xoá (không commit, git đã bỏ qua).
4. Việc dọn nhỏ đưa vào commit đầu của Sprint 5: xoá phần `404-black.png` khỏi dòng 404 trong
   `data/product-images/SOURCES.md` (file đã bỏ, seed không dùng).
5. Tạo nhánh `sprint/05-scaling-cloudinary` và bắt đầu Sprint 5 ngay.

---

## 2. Sprint 5: Stateless, nhiều instance, Cloudinary (nhánh `sprint/05-scaling-cloudinary` từ `master` mới nhất)

**Mục tiêu**: nhiều instance dùng chung một PostgreSQL vẫn chạy đúng; ảnh tải lên không phụ thuộc ổ đĩa instance;
chứng minh được **ngay trên máy** bằng cụm 3 tiến trình + load balancer. **Không Redis, không Docker trên máy.**

### Thiết kế đã chốt (subagent không tự đổi)

- **Rate limit dùng chung**: bảng `rate_limit_buckets (key varchar(200) PRIMARY KEY, count int NOT NULL,
  expires_at timestamptz NOT NULL)`. Mỗi lần đếm một câu lệnh:
  `INSERT ... VALUES ($key, 1, now() + $window) ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
  expires_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() + $window ELSE rate_limit_buckets.expires_at END
  RETURNING count, expires_at`. Dọn dòng hết hạn mỗi ~10 phút (một câu `DELETE` có `LIMIT` qua CTE).
  Chọn store bằng `RATE_LIMIT_STORE=memory|database`: **mặc định `memory`** để `npm test` và hành vi hiện tại không đổi;
  cụm local và Cloud Run đặt `database`.
  DB lỗi khi đếm: **cho qua và ghi log** (fail-open), comment giải thích lý do.
- **Realtime đánh giá chéo instance**: bảng `review_events (id bigserial PRIMARY KEY, product_id int NOT NULL,
  origin varchar(64) NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`, index
  `(id)` sẵn có và `(created_at)`.
  - Mỗi thay đổi đánh giá công khai **luôn** ghi một sự kiện (không phụ thuộc instance đang ghi có subscriber hay không:
    đây là chỗ khác so với `review.service.js` hiện nay).
  - Instance ghi sự kiện vẫn phát ngay cho client cục bộ như hiện tại.
  - Mỗi instance **chỉ khi đang có ≥ 1 websocket** mới đọc `SELECT ... WHERE id > $lastSeenId ORDER BY id LIMIT 200`
    mỗi ~1,5 giây, **bỏ qua sự kiện có `origin` = chính mình**, phát cho client cục bộ của đúng `product_id`.
    `lastSeenId` khởi tạo bằng `MAX(id)` lúc bắt đầu đọc (không phát lại lịch sử).
  - Không còn socket nào thì dừng đọc (để Neon được ngủ). Dọn sự kiện cũ hơn 1 giờ mỗi ~10 phút.
  - Chế độ `REVIEW_EVENTS_MODE=direct|database`: **mặc định `direct`** (hành vi hiện tại); cụm local và Cloud Run đặt
    `database`.
  - Không dùng `LISTEN/NOTIFY` (cần kết nối trực tiếp giữ mở, làm Neon không ngủ, và không chạy qua pooler).
- **Websocket tiết kiệm**: `public/js/review-live.js` đóng kết nối khi tab bị ẩn quá **2 phút**; khi tab hiện lại thì mở lại
  và tải lại danh sách đánh giá như lúc kết nối lại hiện nay.
- **Worker hết hạn thanh toán**: mỗi lượt chạy trong một giao dịch, câu đầu tiên `SELECT pg_try_advisory_xact_lock(<hằng
  số bigint cố định>)`; trả `false` thì bỏ qua lượt. **Chỉ dùng biến thể `_xact_`** (khoá theo giao dịch): biến thể theo
  phiên không chạy đúng qua pooler của Neon.
- **Định danh instance** (`src/infra/instance.js`): `INSTANCE_ID` nếu có; nếu không, trên Cloud Run (`K_REVISION` có giá
  trị) là `<K_REVISION>-<6 ký tự ngẫu nhiên lúc khởi động>`; trên máy là `<hostname>:<PORT>`. Mọi phản hồi có header
  `X-Instance`.
- **`GET /healthz`**: `200 { "status": "ok", "db": "ok", "instance": "..." }`; DB không trả lời trong 2 giây → `503`
  `{ "status": "error", "db": "down", "instance": "..." }`. Không lộ chuỗi kết nối, phiên bản hay stack trace. Không qua
  `attachUser`/CSRF; không ghi log mỗi lần gọi.
- **Lưu ảnh**: `PRODUCT_IMAGE_STORAGE=local|cloudinary` (mặc định `local`).
  - `cloudinary` đọc `CLOUDINARY_URL` (`cloudinary://<key>:<secret>@<cloud>`), tải lên thư mục `digishop/products`,
    `public_id` = UUID mới, trả `secure_url`.
  - Ảnh vẫn qua `sharp` như hiện nay **trước** khi tải lên.
  - `uploadedImageFromPublicPath` nhận thêm URL dạng `https://res.cloudinary.com/<cloud>/image/upload/v<n>/digishop/products/<uuid>.<png|webp>`
    đúng cloud đang cấu hình; mọi URL khác (kể cả ảnh mẫu `/uploads/products/<tên file>`) trả `null`, nên ảnh mẫu không bao
    giờ bị xoá.
  - Ảnh mẫu của seed vẫn phục vụ từ `/uploads/products` (thư mục trong bản build).
- **Cụm local**: `npm run cluster` bật 3 tiến trình app (cổng 3101–3103, `INSTANCE_ID` = `local-1..3`, cùng
  `DATABASE_URL`, `RATE_LIMIT_STORE=database`, `REVIEW_EVENTS_MODE=database`; cả 3 đều chạy worker để chứng minh
  advisory lock hoạt động) và load balancer Node ở cổng **8080**
  (round-robin, proxy websocket, gửi `X-Forwarded-For`, bỏ qua instance không trả `/healthz` trong 5 giây gần nhất).
  `APP_ORIGIN` khi chạy cụm phải gồm `http://localhost:8080` (hướng dẫn người dùng thêm vào `.env`, agent không sửa `.env`).
  Cụm chỉ để chứng minh và test local; Cloud Run có load balancer riêng.

### Việc cho subagent

> Mỗi brief kèm nguyên văn mục 0 của `postgres-s3-s5-deploy.prompt.md` (ràng buộc an toàn + quy tắc cách ly) và mục 0
> của file này.

#### S5-A: Rate limit dùng chung

**File được sửa**: `prisma/schema.prisma` (thêm model `RateLimitBucket`), `prisma/migrations/<ts>_rate_limit_buckets/migration.sql`
(mới), `src/middlewares/auth.js` (**chỉ** `rateBuckets`, hàm dọn, `rateLimitAuth`), `src/infra/rate-limit-store.js` (mới),
`test/rate-limit-store.test.js` (mới), `test-db/rate-limit.db-test.js` (mới), `.env.example`.

**Việc cần làm** (skill `tdd`):
1. Interface `{ hit(key, windowMs) → Promise<{ count, resetAt }> }` với 2 bản `memory` (chuyển nguyên logic `Map` hiện có,
   kể cả giới hạn 10.000 khoá) và `database`.
2. `rateLimitAuth` dùng store được chọn; giữ nguyên `RATE_LIMITS`, cách ghép khoá theo IP và identifier, mã lỗi, message,
   header, mã HTTP.
3. Test bản `memory` đầy đủ; test DB: 2 client Prisma riêng (mô phỏng 2 instance) đếm cùng một khoá, vượt ngưỡng ở client này
   thì client kia cũng thấy vượt; khoá hết hạn được đếm lại từ 1.

**Tiêu chí hoàn thành**: mọi test rate limit cũ xanh không sửa; test mới xanh.

#### S5-B: Realtime đánh giá qua bảng sự kiện

**Phụ thuộc**: S5-A xong (cùng `schema.prisma`).

**File được sửa**: `prisma/schema.prisma` (thêm model `ReviewEvent`), `prisma/migrations/<ts>_review_events/migration.sql`
(mới), `src/realtime/review-hub.js`, `src/realtime/review-events.js` (mới), `src/services/review.service.js` (**chỉ** hàm
broadcast ~111–115), `public/js/review-live.js` (**chỉ** phần đóng khi ẩn tab lâu), `test/review-realtime.integration.test.js`,
`test-db/review-events.db-test.js` (mới), `.env.example`.

**Việc cần làm** (skill `tdd`):
1. `review-events.js`: `record(productId, payload)`, `startPolling(onEvent)`, `stopPolling()`, dọn định kỳ; chế độ
   `direct` thì `record` không ghi gì.
2. Hub tự bật/tắt vòng đọc theo số socket đang mở; payload phát ra giữ nguyên định dạng client đang nhận.
3. `review.service.js`: luôn `record` khi chế độ `database`; vẫn phát cục bộ khi có subscriber.
4. Test DB: 2 hub dùng 2 client Prisma, client của hub B nhận sự kiện tạo ở hub A trong ≤ 3 giây, hub A không phát trùng;
   không có socket thì không có truy vấn nào tới `review_events` (đếm bằng spy).

**Tiêu chí hoàn thành**: test realtime cũ xanh; test mới xanh.

#### S5-C: Worker hết hạn thanh toán chạy ở một nơi

**Phụ thuộc**: không (song song với S5-A).

**File được sửa**: `src/services/payment-expiration.worker.js`, `src/repositories/payment.repository.js` (**chỉ** thêm hàm
chạy lượt trong giao dịch có khoá, nếu cần), `test/payment-expiration*.test.js` (hiện có hoặc mới),
`test-db/payment-worker.db-test.js` (mới).

**Tiêu chí hoàn thành**: test DB chạy 2 worker cùng lúc trên cùng dữ liệu, chỉ một bên xử lý; mỗi đơn quá hạn chỉ được trả
kho và trả lượt voucher **một lần**; hành vi khi chỉ có 1 instance không đổi.

#### S5-D: Cloudinary cho ảnh tải lên

**Phụ thuộc**: không (song song).

**File được sửa**: `src/services/product-image-storage.js` (có thể tách thành thư mục `src/services/product-image-storage/`
với `index.js`, `local.js`, `cloudinary.js` nhưng **giữ nguyên đường dẫn require** `../services/product-image-storage`),
`test/product-image-storage.test.js` (mới), `test/product-image-upload.integration.test.js` (chỉ thêm ca cho chế độ
cloudinary nếu cần), `package.json` (thêm `cloudinary` ghim bản chính xác, hoặc gọi REST API ký bằng `node:crypto` và
`fetch` để khỏi thêm thư viện: chọn một, ghi lý do), `.env.example`.

**Không sửa** `src/controllers/admin.controller.js` trừ khi buộc phải đổi chữ ký hàm; nếu buộc phải đổi thì dừng báo
agent chính.

**Việc cần làm** (skill `tdd`): như thiết kế. Test bản Cloudinary bằng fake (không gọi mạng thật trong `npm test`).

**Tiêu chí hoàn thành**: chế độ `local` y hệt hiện nay (test cũ xanh); test bản Cloudinary xanh; ảnh mẫu không bao giờ bị
nhận là "ảnh do app tải lên".

#### S5-E: Healthz, X-Instance, cụm local và tài liệu scaling

**Phụ thuộc**: S5-A, S5-B, S5-C xong.

**File được sửa**: `src/app.js` (**chỉ** thêm middleware `X-Instance` và mount route health **trước** `attachUser`),
`src/routes/health.routes.js` (mới), `src/infra/instance.js` (mới), `scripts/cluster/start-cluster.js` (mới),
`scripts/cluster/load-balancer.js` (mới), `scripts/cluster/smoke.js` (mới: gọi `/healthz` 30 lần qua một URL, mặc định
`http://localhost:8080`, in bảng đếm theo `X-Instance`), `package.json` (scripts `cluster`, `cluster:smoke`; thêm
`http-proxy` ghim bản chính xác nếu dùng), `docs/scaling.md` (mới, tiếng Việt), `test/health.integration.test.js` (mới).

**Việc cần làm**:
1. `start-cluster.js`: Ctrl+C tắt sạch cả 4 tiến trình; tiến trình con chết thì in rõ và load balancer bỏ qua nó, không kéo
   sập cả cụm.
2. `docs/scaling.md`: sơ đồ (trình duyệt → load balancer → 3 instance → PostgreSQL; Cloudinary cho ảnh), bảng "nguồn trạng
   thái → cách xử lý → vì sao", cách chạy cụm, cách chứng minh (smoke, realtime chéo instance, rate limit dùng chung,
   tắt một instance), mục "Trên Cloud Run" để trống cho giai đoạn D, chỗ chèn ảnh chụp minh chứng.

**Tiêu chí hoàn thành**: `npm run cluster` + `npm run cluster:smoke` thấy cả 3 instance; test health xanh.

### Sóng giao việc

| Sóng | Việc | Ghi chú |
|---|---|---|
| 1 | S5-A, S5-C, S5-D | Không trùng file |
| 2 | S5-B | Sau S5-A (cùng `schema.prisma`) |
| 3 | S5-E | Sau A, B, C |

### Kiểm tra cuối Sprint 5 (agent chính)

1. `npm test` (≥ mốc, 0 fail); `npm run test:db` (người dùng chạy nếu Prisma chặn).
2. Chế độ một instance (`npm start`, PORT=3100, mặc định `memory`/`direct`/`local`): luồng mua hàng, đánh giá realtime
   2 tab, tải ảnh admin vẫn như cũ.
3. Cụm (`npm run cluster`, mở `http://localhost:8080`):
   - `npm run cluster:smoke`: 3 instance đều nhận request.
   - 2 tab cùng sản phẩm, xác nhận `X-Instance` khác nhau (DevTools), đánh giá ở tab 1 thấy ở tab 2 trong ≤ 3 giây.
   - Đăng nhập sai liên tục: bị chặn đúng ngưỡng dù request rải qua 3 instance.
   - Dừng một instance: web vẫn chạy.
   - Tạo đơn MoMo/VNPay rồi bỏ ngang: log cho thấy chỉ một instance xử lý hết hạn mỗi lượt.
4. Review tổng theo mục 9 của `postgres-s3-s5-deploy.prompt.md`.

### CỔNG DỪNG 5 (cổng cuối trước deploy)

Báo cáo + đề xuất commit, rồi **dừng hẳn**. Ghi nguyên văn cho người dùng:

> **Đây là lúc bạn test toàn bộ trên máy**, cả chế độ một instance (`npm start`) lẫn cụm (`npm run cluster`) theo checklist
> trên. Khi hài lòng và đã commit, nhắn **"bắt đầu deploy"** thì giai đoạn D mới bắt đầu.

Commit gợi ý:
- `feat(auth): share rate limits across instances through the database`
- `feat(review): deliver realtime review updates across instances`
- `fix(payment): run payment expiration on one instance at a time`
- `feat(admin): store uploaded product photos on cloudinary when configured`
- `feat(infra): health check, instance header and a local three-instance cluster`

---

## 3. Giai đoạn D: Cloud Run + Neon + Cloudinary (nhánh `phase/d-cloud-run` từ `master` mới nhất)

> **Chỉ bắt đầu khi trong hội thoại có câu "bắt đầu deploy" của người dùng.** Không có thì dừng.

### Phân vai

| Việc | Ai làm |
|---|---|
| Tạo tài khoản Google Cloud, gắn thẻ, nâng tài khoản trả phí, tạo project, bật Cloud Run / Cloud Build / Artifact Registry | **Người dùng** |
| Đặt **cảnh báo ngân sách 1 USD** | **Người dùng** (agent nhắc) |
| Cài Google Cloud CLI, `gcloud auth login`, `gcloud config set project ...` | **Người dùng** |
| Tạo Neon project (vùng Singapore), lấy chuỗi **pooled** và **direct** | **Người dùng** |
| Tạo Cloudinary, lấy `CLOUDINARY_URL` | **Người dùng** |
| Điền mọi giá trị bí mật vào `deploy/cloud-run.env.yaml` (gitignore) | **Người dùng** |
| Cấu hình Google OAuth (Authorized JavaScript origins), URL trả về và IPN của MoMo/VNPay sandbox | **Người dùng** (agent đưa giá trị cần điền) |
| File cấu hình, script, tài liệu, sửa code nhỏ cho môi trường cloud | Agent (subagent) |
| Chạy `gcloud`, migrate/seed lên Neon | **Người dùng tự chạy**, hoặc agent chạy **từng lệnh sau khi người dùng đồng ý từng lệnh** |

Agent **không bao giờ** đọc, in, chép nội dung `deploy/cloud-run.env.yaml`, chuỗi kết nối Neon hay `CLOUDINARY_URL`.

### D-1: Bản build cho Cloud Run

**File được sửa**: `Dockerfile` (mới; Cloud Build đóng gói trên cloud, **máy người dùng không cần Docker**), `.dockerignore`
(mới), `.gcloudignore` (mới), `.gitignore` (thêm `deploy/*.env.yaml`, giữ `deploy/*.env.example.yaml`), `package.json`
(chỉ thêm `"engines": { "node": "24.x" }` nếu chưa có).

**Việc cần làm**:
1. `Dockerfile` nhiều tầng từ `node:24-slim`: `npm ci --omit=dev`, `npx prisma generate`, chép `server.js`, `src/`,
   `public/`, `prisma/` (trừ `migrations-sqlserver`), `prisma.config.cjs`, `data/product-images/` **chỉ các file seed**
   (tên dạng `NNN-*` và `SOURCES.md`, không chép file UUID), chạy bằng user không phải root, `CMD ["node", "server.js"]`.
2. `.dockerignore` / `.gcloudignore` giống nhau: loại `.env*` (trừ `.env.example`), `deploy/*.env.yaml`, `node_modules`,
   `.git`, `test`, `test-db`, `test-support`, `docs`, `prisma/migrations-sqlserver`, `data/product-images/[0-9a-f]*-*-*`.

**Tiêu chí hoàn thành**: đọc lại 2 file ignore, chắc chắn không file bí mật hay ảnh UUID nào vào bản build; nhờ người dùng
chạy `gcloud meta list-files-for-upload` để xác nhận (lệnh chỉ liệt kê, không tải gì lên).

### D-2: Cấu hình và script deploy

**File được sửa**: `deploy/cloud-run.env.example.yaml` (mới, chỉ khoá và giá trị mẫu), `deploy/deploy.ps1` (mới),
`deploy/migrate-neon.ps1` (mới), `docs/deploy.md` (mới, tiếng Việt).

**Việc cần làm**:
1. `cloud-run.env.example.yaml`: mọi biến trong `.env.example` mà production cần, cộng:
   `DATABASE_URL` (Neon **pooled**, có `sslmode=require`), `DB_SSL=true`, `DB_POOL_MAX=5`, `APP_ORIGIN` (URL Cloud Run),
   `TRUST_PROXY=1`, `PAYMENT_ENV=sandbox`, `PRODUCT_IMAGE_STORAGE=cloudinary`, `CLOUDINARY_URL`,
   `RATE_LIMIT_STORE=database`, `REVIEW_EVENTS_MODE=database`. **Không** đặt `PORT` (Cloud Run tự cấp).
2. `deploy.ps1` (PowerShell 5.1, không `&&`): kiểm tra `deploy/cloud-run.env.yaml` tồn tại và không phải bản example, rồi
   `gcloud run deploy digishop --source . --region asia-southeast1 --allow-unauthenticated
   --env-vars-file deploy/cloud-run.env.yaml --min-instances 0 --max-instances 3 --concurrency 20 --cpu 1 --memory 512Mi
   --timeout 3600 --no-session-affinity`. Kiểm tra lại từng cờ với tài liệu gcloud hiện hành (CPU chỉ cấp khi có request
   là mặc định; nếu cần ghi rõ cờ tương ứng).
3. `migrate-neon.ps1`: đọc chuỗi **direct** từ biến môi trường `NEON_DIRECT_URL` do người dùng đặt trong phiên PowerShell
   (không ghi file), chạy `npx prisma migrate deploy` với `DATABASE_URL` tạm bằng chuỗi đó; chạy `node prisma/seed.js`
   **chỉ khi** truyền `-Seed`. Không in chuỗi kết nối.
4. `docs/deploy.md`: từng bước cho người dùng, theo thứ tự:
   1. Tạo project, bật API, **cảnh báo ngân sách 1 USD**.
   2. Neon (Singapore): lấy chuỗi pooled và direct.
   3. Cloudinary: lấy `CLOUDINARY_URL`.
   4. Chép `cloud-run.env.example.yaml` → `cloud-run.env.yaml`, điền giá trị (chưa biết URL Cloud Run thì tạm để
      `APP_ORIGIN` một giá trị https bất kỳ, sửa ở bước 7).
   5. `$env:NEON_DIRECT_URL = "..."` rồi `./deploy/migrate-neon.ps1 -Seed`.
   6. `./deploy/deploy.ps1`, lấy URL dịch vụ.
   7. Sửa `APP_ORIGIN` = URL đó, chạy lại `deploy.ps1`.
   8. Thêm URL vào Google OAuth; cấu hình URL trả về/IPN MoMo, VNPay sandbox (ghi rõ đường dẫn route của app).
   9. Quy tắc dọn image cũ trong Artifact Registry (giữ 2 bản mới nhất).
   10. Mở link một lần trước buổi chấm cho app và DB "dậy" sẵn.
   11. Sau khi chấm: đổi mật khẩu admin, tạo tài khoản demo chỉ quyền khách hàng cho CV, giữ `PAYMENT_ENV=sandbox`.
   12. Bảng chi phí dự kiến và các cài đặt chặn phát sinh tiền (min 0, max 3, cảnh báo ngân sách, dọn image).

**Tiêu chí hoàn thành**: người chưa biết dự án làm theo `docs/deploy.md` được từ đầu tới cuối; không file nào trong git chứa
bí mật.

### D-3: Bằng chứng scaling trên Cloud Run

**File được sửa**: `scripts/cluster/cloud-smoke.js` (mới: N request song song tới URL truyền vào, gom `X-Instance`, in
bảng), `docs/scaling.md` (điền mục "Trên Cloud Run"), `package.json` (script `cloud:smoke`).

**Việc cần làm**: hướng dẫn tạm đặt `--concurrency 1` khi quay video để Cloud Run bật nhiều instance, chạy `cloud:smoke`
(thấy ≥ 2 instance), demo realtime chéo instance, rồi trả về `--concurrency 20`. Liệt kê ảnh cần chụp: Metrics "Instance
count", kết quả `cloud:smoke`, 2 tab realtime, `/healthz` khác instance.

### Kiểm tra cuối giai đoạn D (cùng người dùng)

1. URL Cloud Run mở trang chủ; `/healthz` trả `ok`.
2. Lặp lại checklist luồng chính trên URL thật: mua hàng khách vãng lai, đăng nhập email và Google, voucher, điểm,
   MoMo/VNPay sandbox, email đặt hàng, admin (sản phẩm, danh mục, đơn, dashboard).
3. Tải ảnh trong admin: ảnh nằm trên Cloudinary, vẫn hiện sau khi deploy lại.
4. `cloud:smoke` thấy nhiều instance; realtime chéo instance chạy.
5. Trang Billing: 0 hoặc gần 0.

### CỔNG DỪNG D

Báo cáo + đề xuất commit, rồi dừng. Gợi ý:
- `build(deploy): container build for cloud run`
- `docs(deploy): step-by-step cloud run, neon and cloudinary setup`
- `feat(infra): smoke test that shows load balancing across cloud run instances`
