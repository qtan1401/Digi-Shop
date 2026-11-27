# Sprint 1 + 2: prompt cho agent chính (Digi-Shop)

> File này là **prompt điều phối**. Agent chính đọc toàn bộ, tự chia việc, giao từng việc nhỏ cho **subagent**,
> sau đó **review, chạy test, kiểm tra trên trình duyệt**. Cuối cùng **chỉ đề xuất** commit (không tự commit, không push).
> Người dùng sẽ xem và quyết định.

---

## 0. Bối cảnh bắt buộc phải đọc trước

- Repo: `A:\Digi-Shop`. Stack: Node.js/Express (CommonJS, 4 spaces), Prisma + SQL Server, frontend HTML/JS thuần
  (`public/`), test bằng `node --test` (`npm test`, hiện **355 pass / 0 fail**, phải giữ nguyên hoặc tăng).
- Đề bài: `A:\NodeJS Final Project.pdf` (rubric ở trang 7–10). Các mục liên quan sprint này:
  - **#23 Product rating with stars**: *"Users are not required to log in to leave comments, but they must be logged in
    (**without the need to make a purchase**) in order to rate the product with stars."*
  - **#10 Pagination**: *"It should show the page numbers, even if there is only one page."*
  - **#14 Product search by keyword**.
  - **#19 Checkout process**: *"Guides users through a **multi-step process** to enter payment and shipping details,
    and confirm orders."*
- Đọc `AGENTS.md`, `GLOSSARY.md`, `docs/agents/domain.md` để dùng đúng thuật ngữ.
- Quy ước commit của repo: Conventional Commits, tiếng Anh, chữ thường sau dấu `:`, có scope, ví dụ
  `feat(review): guest comments and realtime review updates over websocket`,
  `fix(shop): give back voucher quantity when an order is cancelled`,
  `chore(catalog): ...`. Dòng cuối: `Co-Authored-By: Claude <noreply@anthropic.com>`.

### Ràng buộc an toàn (áp dụng cho agent chính VÀ mọi subagent)

1. Làm trên nhánh mới `sprint/01-02-review-rules-checkout-steps` tạo từ `master` hiện tại. Không đổi sang nhánh khác,
   không push, không merge, **không commit** (chỉ đề xuất ở bước cuối).
2. **Không** sửa `.env`, không in giá trị bí mật. **Không** stage/commit `package-lock.json` (file này đang bị sửa sẵn do
   `npm install` trên Windows; bỏ qua nó). Không chạy `npm audit fix`.
3. **Không** thêm migration, không đổi schema Prisma trong 2 sprint này.
4. Không đụng auth, thanh toán MoMo/VNPay, voucher, điểm thưởng ngoài phạm vi ghi rõ bên dưới.
5. Server dev của người dùng đang chạy ở cổng **3000**: không kill. Khi cần chạy app để kiểm tra, dùng `PORT=3100`
   (PowerShell: `$env:PORT=3100; npm start`), tắt nó khi xong.
6. Mọi nội dung do người dùng nhập phải render bằng `textContent`/thuộc tính hoặc `escapeHtml` như code hiện có (chống XSS).
7. Thông báo cho người dùng cuối viết bằng tiếng Việt, giữ giọng văn hiện có.
8. Mỗi subagent **chỉ được sửa các file nằm trong cột "File được sửa"** của việc nó nhận. Cần sửa file khác thì dừng
   lại và báo cho agent chính (để tránh hai subagent ghi đè cùng một file).

### Skill đã cài (trong `.agents/skills/`), dùng khi phù hợp

| Skill | Dùng khi |
|---|---|
| `tdd` | Mọi thay đổi logic có test: viết/sửa test đỏ trước, rồi sửa code cho xanh (S1-A, S1-D, S2-C) |
| `diagnosing-bugs` | Test fail mà nguyên nhân chưa rõ, hoặc lỗi chỉ xuất hiện trên trình duyệt |
| `frontend-design`, `ui-ux` | Thiết kế stepper, bố cục 3 bước, trạng thái mobile (S2-A, S2-D, S1-B) |
| `domain-modeling` | Cập nhật định nghĩa **Verified reviewer** trong `GLOSSARY.md` / spec khi luật thay đổi (S1-A) |
| `code-review` | Agent chính tự review toàn bộ diff trước khi đề xuất commit (bước 4) |

---

## 1. Quy trình điều phối (agent chính)

1. **Chuẩn bị**: `git status`, `git switch -c sprint/01-02-review-rules-checkout-steps`, chạy `npm test` để xác nhận mốc
   355 pass. Ghi lại mốc.
2. **Giao việc cho subagent** theo bảng phụ thuộc ở mục 4. Mỗi subagent nhận **nguyên văn** brief của việc đó (mục 2, 3)
   cộng toàn bộ mục 0 (bối cảnh + ràng buộc). Chạy song song các việc không phụ thuộc và **không trùng file**.
3. **Sau mỗi subagent**: đọc diff của nó (`git diff -- <file>`), đối chiếu "Tiêu chí hoàn thành", chạy test liên quan.
   Không đạt thì gửi lại cho **chính subagent đó** kèm nhận xét cụ thể (file:dòng, kỳ vọng vs thực tế), tối đa 2 vòng;
   sau đó tự sửa.
4. **Review tổng** (mục 5) → **kiểm tra trình duyệt** (mục 6) → **đề xuất commit** (mục 7).

---

## 2. Sprint 1: Đúng luật đề bài (không migration)

### S1-A: Bỏ điều kiện "đã mua hàng" khi chấm sao (backend + test)

**File được sửa**: `src/services/review.service.js`, `src/repositories/review.repository.js` (chỉ comment/export nếu cần),
`test/product-review.integration.test.js`, `test/review-realtime.integration.test.js` (chỉ nếu test ở đó dựa vào luật cũ),
`GLOSSARY.md` (mục **Verified reviewer**, dòng ~133), `docs/specs/vouchers-and-product-reviews.md` (dòng ~36).

**Hiện trạng**:
- `review.service.js` `createReview` (~dòng 261–278): nếu `!hasDeliveredOrderForProduct(user.id, productId)` thì ném
  `ReviewError("REVIEW_NOT_ELIGIBLE", 403, ...)`.
- `getMyReview` (~dòng 236–244): `eligible` = kết quả `hasDeliveredOrderForProduct`.
- `test/product-review.integration.test.js` mục `// ===== Eligibility =====` (~dòng 241–292) đang khẳng định luật cũ.

**Việc cần làm** (dùng skill `tdd`):
1. Sửa test trước theo luật mới:
   - Thay test *"customers without a DELIVERED order for the product cannot review it"* bằng: khách hàng **đã đăng nhập,
     chưa có đơn nào** gửi `{ rating: 5 }` → `201`; `GET /reviews/mine` → `eligible: true`.
   - Thay test *"a delivered order of one variant makes the whole product reviewable"* bằng một test ngắn khẳng định có hay
     không có đơn đều không ảnh hưởng (vd BOB không có đơn vẫn `201`).
   - Giữ nguyên các test: một người một đánh giá cho mỗi sản phẩm, `USERNAME_REQUIRED` (bỏ `deliver(...)` trong đó), admin
     và người ẩn danh không được chấm sao (`403` / `401`), CSRF, khách gửi `rating` → `401 AUTH_REQUIRED`.
2. Sửa code: bỏ kiểm tra `hasDeliveredOrderForProduct` trong `createReview`; trong `getMyReview`, khách hàng (role `user`)
   luôn `eligible: true`. Admin/không đăng nhập giữ như cũ (`eligible: false`).
3. `hasDeliveredOrderForProduct` không còn được dùng: **xoá** hàm và export trong `review.repository.js` nếu không còn ai gọi
   (`grep -rn hasDeliveredOrderForProduct src test test-support`); nếu fake trong `test-support/` có hàm cùng tên thì xoá luôn.
4. **Giữ nguyên** bước đặt tên người dùng (`USERNAME_REQUIRED`): đây là bước trong hộp thoại, không phải điều kiện mua hàng.
5. Cập nhật comment đầu file `review.service.js` (dòng 2–3) và định nghĩa **Verified reviewer** trong `GLOSSARY.md` + spec
   cho khớp luật mới (dùng skill `domain-modeling`): người chấm sao chỉ cần là khách hàng đã đăng nhập.

**Tiêu chí hoàn thành**: `node --test test/product-review.integration.test.js test/review-realtime.integration.test.js`
xanh; `grep -rn "REVIEW_NOT_ELIGIBLE" src` không còn chỗ ném lỗi này; không thay đổi hành vi bình luận của khách.

### S1-B: Giao diện đánh giá theo luật mới (frontend)

**File được sửa**: `public/js/product-reviews.js` (chỉ file này).

**Hiện trạng**: dòng ~154 hiển thị *"Đánh giá mở sau khi bạn nhận đơn có …"* khi `!m.eligible`; dòng ~418 xử lý mã lỗi
`REVIEW_NOT_ELIGIBLE`.

**Việc cần làm**:
1. Khách hàng đã đăng nhập, chưa đánh giá → luôn thấy nút **"Viết đánh giá"** (bỏ nhánh thông báo "sau khi nhận đơn"
   hoặc chỉ giữ làm phòng hờ khi server trả `eligible: false` với role user, với câu chữ trung tính không nhắc mua hàng).
2. Giữ xử lý `REVIEW_NOT_ELIGIBLE` ở dòng ~418 như một nhánh phòng hờ, nhưng đổi thông báo không nhắc tới "nhận đơn".
3. Câu gợi ý cho khách (`m.kind === "guest"`) giữ nguyên: *"Bình luận không cần đăng nhập. Muốn chấm sao thì đăng nhập."*
4. Không đổi cấu trúc DOM/class đang được CSS và websocket (`review-live.js`) dùng.

**Tiêu chí hoàn thành**: trên trang chi tiết, tài khoản mới tạo (chưa có đơn) mở được hộp thoại, chấm sao, gửi thành công;
tab thứ hai cùng trang nhận cập nhật realtime không cần tải lại.

### S1-C: Phân trang luôn hiện số trang

**File được sửa**: `public/js/my-orders.js`, `public/js/admin-vouchers.js`, `public/js/admin-kit.js` (chỉ nếu `pagerHtml`
tự ẩn khi 1 trang), và các file admin danh sách khác **chỉ khi** kiểm tra cho thấy chúng ẩn pager khi 1 trang:
`public/js/admin.js` (danh sách sản phẩm), `public/js/admin-users.js`, `public/js/admin-orders.js`, `public/js/admin-reviews.js`.

**Hiện trạng**:
- `my-orders.js` ~dòng 174–176: không có dữ liệu thì xoá pager; `totalPages <= 1` thì cũng không vẽ số trang.
- `admin-vouchers.js` ~dòng 184: `state.meta.totalPages > 1 ? pager : ""`.
- `public/js/catalog-renderer.js` `renderPagination` đã đúng (luôn tối thiểu 1 trang): **dùng làm chuẩn, không sửa**.

**Việc cần làm**:
1. Quy tắc chung: khi danh sách đã tải xong và có **ít nhất 1 dòng**, luôn vẽ pager có số trang (trang `1` ở trạng thái
   hiện tại, mũi tên trước/sau bị vô hiệu hoá). Danh sách rỗng thì hiện trạng thái trống như cũ, không cần pager.
2. Rà từng file trong danh sách trên bằng cách đọc code (không đoán); chỉ sửa file thực sự ẩn pager khi 1 trang. Ghi lại
   kết quả rà (file nào đã đúng, file nào đã sửa) trong báo cáo.
3. Không đổi API hay `pageSize` (admin đơn hàng giữ **20**/trang).

**Tiêu chí hoàn thành**: lọc danh sách xuống còn 1 trang (vd tìm 1 đơn cụ thể ở trang Đơn hàng của tôi / lọc voucher) vẫn
thấy số "1" và hai mũi tên mờ; không lỗi console.

### S1-D: Tìm kiếm từ khoá 2 ký tự

**File được sửa**: `src/services/product.service.js`, `public/js/main.js`, test liên quan tới ngưỡng tìm kiếm
(tìm bằng `grep -rn "q=" test` và `grep -rn ">= 3" src public/js`).

**Hiện trạng**: `product.service.js` ~dòng 391 `q: Array.from(q).length >= 3 ? q : null`; `main.js` dòng ~86, ~112, ~196
cũng dùng ngưỡng 3. Hệ quả: tìm "K2", "G5" không ra kết quả.

**Việc cần làm** (skill `tdd`):
1. Đưa ngưỡng về **một hằng số** `MIN_SEARCH_LENGTH = 2` ở server; frontend dùng cùng giá trị (định nghĩa một chỗ trong
   `main.js`). Không tạo endpoint mới.
2. Thêm/sửa test: `GET /api/products?q=K2` trả về Keychron K2; `q` 1 ký tự bị bỏ qua (trả danh sách không lọc, như hành vi
   hiện tại với chuỗi ngắn); giữ giới hạn tối đa 120 ký tự.
3. Cập nhật mọi câu gợi ý trên giao diện nhắc "3 ký tự" (nếu có) thành "2 ký tự".

**Tiêu chí hoàn thành**: test mới xanh; trên `catalog.html` gõ "K2" ra đúng sản phẩm.

---

## 3. Sprint 2: Thanh toán nhiều bước (chỉ frontend, không đổi API)

### Thiết kế đã chốt (agent chính đưa nguyên văn cho các subagent S2)

- Trang `public/checkouts.html`, nội dung do `renderCheckoutForm()` trong `public/js/payment.js` (~dòng 294–375) dựng.
- **3 bước**, cột tóm tắt (`aside.checkout-summary`) hiện suốt quá trình:
  1. **Giao hàng**: email (chỉ khi là khách, `guestEmailHtml()`), chọn địa chỉ đã lưu (`#saved-address-picker`,
     tự chọn địa chỉ mặc định như hiện tại), họ tên `#customer-name`, SĐT `#customer-phone`, địa chỉ `#customer-address`,
     ghi chú `#customer-note`, và khối số lượng `qtyControls` (nếu có).
  2. **Thanh toán**: phương thức `#payment-method`, khối voucher `#voucher-block`, khối điểm `#points-block`
     (chuyển hai khối này từ `aside` sang panel bước 2). Bảng tiền `#summary-breakdown` **ở lại** trong `aside`.
  3. **Xác nhận**: tóm tắt chỉ đọc (người nhận, SĐT, địa chỉ, ghi chú, phương thức, danh sách sản phẩm), nút
     "Sửa" quay về đúng bước, và nút đặt hàng `#btn-checkout` (giữ nguyên `id`, `onclick="handleCheckout()"`, logic
     `disabled` theo `checkoutBlocked`/`updatePayButton`).
- **Giữ nguyên mọi `id` hiện có**: `handleCheckout`, `validateForm`, `attachLiveValidation`, `CheckoutVouchers.mount`,
  `CheckoutPoints`, `initSavedAddresses`, `applyDraftForm` đều tìm phần tử theo `id`. Các panel chỉ **ẩn/hiện**
  (thuộc tính `hidden`), **không render lại**, để không mất trạng thái voucher/điểm/địa chỉ.
- Nút "Tiếp tục" của bước 1 chỉ kiểm tra các trường bước 1; bước 2 kiểm tra phương thức thanh toán (và trạng thái voucher
  không ở lỗi chặn). `handleCheckout()` vẫn tự gọi `validateForm()` toàn bộ trước khi gửi (giữ làm lớp bảo vệ cuối);
  nếu lỗi nằm ở bước trước thì nhảy về bước đó và focus trường lỗi đầu tiên.
- Khi `checkoutBlocked`, banner gộp giỏ, thông báo sản phẩm không khả dụng, admin bị chặn (`renderForbidden`): giữ nguyên
  hành vi hiện tại (hiện ở đầu trang, trên stepper).
- Truy cập: thanh tiến trình là `<ol>` với `aria-current="step"`; bước đã qua bấm được để quay lại, bước chưa tới bị vô hiệu;
  đổi bước thì focus vào tiêu đề panel (`tabindex="-1"`); phím Enter trong input không tự gửi đơn.
- Responsive: ≥1024px hai cột (form | tóm tắt); <1024px một cột, tóm tắt thu gọn thành dải "Tổng: …₫ ▾" mở rộng được
  ở đầu trang; nút chính đủ 44px, không tràn ngang ở 360px.

### S2-A: Module stepper độc lập

**File được sửa**: tạo mới `public/js/checkout-steps.js`; tạo mới `public/css/checkout-steps.css`.

**Việc cần làm** (skill `frontend-design`, `ui-ux`):
1. IIFE gắn `window.CheckoutSteps = { mount(root, { steps, initialStep, validate, onChange }), goTo(n), current() }`.
   - `steps`: mảng `{ id, title, panel }` (panel là phần tử DOM có sẵn).
   - `validate(stepIndex)` → `true` hoặc `{ ok: false, focus: Element }`; module gọi trước khi sang bước sau.
   - `onChange(stepIndex)` gọi sau mỗi lần đổi bước (để lưu nháp).
   - Module tự dựng thanh tiến trình và các nút "Quay lại / Tiếp tục"; không gọi mạng, không biết gì về voucher/thanh toán.
2. CSS cho thanh tiến trình, panel, nút điều hướng, dải tóm tắt thu gọn trên mobile; dùng biến màu/khoảng cách sẵn có trong
   `public/css/styles.css` (đọc file để lấy đúng token), không đặt màu cứng mới nếu đã có token tương ứng.
3. Không phụ thuộc `payment.js`; viết JSDoc ngắn cho API.

**Tiêu chí hoàn thành**: một file HTML thử tạm (không commit, đặt trong thư mục tạm ngoài repo) mount được 3 panel giả,
chuyển bước bằng chuột/bàn phím, validate chặn đúng.

### S2-B: Gắn stepper vào trang thanh toán (phụ thuộc S2-A)

**File được sửa**: `public/js/payment.js`, `public/checkouts.html` (thêm `<link>` CSS và `<script src="/js/checkout-steps.js">`
**trước** `payment.js`).

**Việc cần làm**:
1. Trong `renderCheckoutForm`: chia nội dung thành 3 panel theo "Thiết kế đã chốt"; chuyển `#voucher-block`, `#points-block`
   (và hai `hr.vc-rule` đi kèm) sang panel bước 2; thêm panel bước 3 với vùng tóm tắt chỉ đọc
   (`#checkout-review`) và chuyển `#btn-checkout` vào panel bước 3.
2. Tách `validateForm` thành hàm kiểm tra theo nhóm trường (vd `validateFields(["customerName","customerPhone",...])`),
   giữ `validateForm()` cũ là gọi toàn bộ nhóm (để `handleCheckout` không đổi hành vi).
3. Bước 3: mỗi lần vào bước thì dựng lại `#checkout-review` từ `formValues()`, tên phương thức thanh toán và danh sách sản phẩm
   hiện tại (dùng `escapeHtml`), có nút "Sửa" gọi `CheckoutSteps.goTo(0|1)`.
4. Nếu `handleCheckout` phát hiện lỗi trường (từ `validateForm` hoặc lỗi server trả về theo field), chuyển về bước chứa
   trường đó.
5. Khách vãng lai: khối voucher chỉ mở khi email hợp lệ (logic `guestEmailSeen` hiện có): vì email ở bước 1 nên khi sang
   bước 2 khối voucher đã sẵn sàng; giữ nguyên listener `change` trên `#customer-email`.
6. Không đổi bất kỳ lời gọi API, payload, hay luồng thanh toán MoMo/VNPay/QR/COD.

**Tiêu chí hoàn thành**: đặt hàng thành công qua 3 bước ở các kịch bản trong mục 6; màn hình thành công giữ nguyên.

### S2-C: Lưu bước hiện tại trong nháp thanh toán (phụ thuộc S2-B)

**File được sửa**: `public/js/checkout-state.js`, `public/js/payment.js` (chỉ `saveCheckoutDraft`, `applyDraftForm` và chỗ
mount stepper), test mới `test/checkout-state.test.js`.

**Hiện trạng**: `normalizeDraft` (~dòng 84–105) giữ `version, createdAt, expiresAt, returnPath, mode, productId,
variantId, cartSnapshot, form`; draft phiên bản khác `DRAFT_VERSION` bị bỏ.

**Việc cần làm** (skill `tdd`):
1. Thêm trường tuỳ chọn `step` (số nguyên 0–2) **không tăng `DRAFT_VERSION`**: thiếu hoặc sai thì coi là `0`.
2. `saveCheckoutDraft` lưu `step` hiện tại (`CheckoutSteps.current()`); `applyDraftForm`/mount dùng nó làm `initialStep`
   (vd từ khối voucher bấm "Đăng nhập" rồi quay lại thì về bước 2).
3. Viết `test/checkout-state.test.js` bằng `node:test`, nạp `public/js/checkout-state.js` với `window`/`sessionStorage`
   giả lập tối thiểu (dùng `vm` của Node), kiểm tra: `step` hợp lệ được giữ; `step` thiếu/âm/>2/không phải số → `0`;
   draft cũ không có `step` vẫn đọc được.

**Tiêu chí hoàn thành**: test mới xanh, `npm test` không giảm số pass.

### S2-D: Kiểm tra giao diện và responsive (sau S2-B)

**File được sửa**: chỉ `public/css/checkout-steps.css` (và `public/css/checkout-auth.css` nếu bắt buộc, phải ghi rõ lý do).

**Việc cần làm** (skill `ui-ux`, `frontend-design`):
1. Chạy app ở `PORT=3100`, chụp màn hình (puppeteer có sẵn trong omp) trang thanh toán ở **360×800, 768×1024, 1280×800**,
   đủ 3 bước, cho cả khách và người dùng đăng nhập.
2. Sửa: tràn ngang, chữ bị cắt, nút dưới 44px, khoảng cách lệch so với phần còn lại của site, dải tóm tắt mobile.
3. Lưu ảnh chụp vào thư mục tạm **ngoài repo** và ghi đường dẫn trong báo cáo.

**Tiêu chí hoàn thành**: không còn lỗi bố cục ở 3 độ rộng; ảnh chụp trước/sau trong báo cáo.

---

## 4. Thứ tự và song song

| Đợt | Việc (chạy song song được) | Ghi chú |
|---|---|---|
| 1 | **S1-A**, **S1-C**, **S1-D**, **S2-A** | Không trùng file |
| 2 | **S1-B** (sau S1-A), **S2-B** (sau S2-A) | Không trùng file |
| 3 | **S2-C** (sau S2-B), **S2-D** (sau S2-B) | S2-C sửa `payment.js` phần nháp; S2-D chỉ sửa CSS |

Nếu môi trường không cho chạy song song, làm tuần tự theo đúng thứ tự trên.

---

## 5. Review tổng của agent chính

1. Dùng skill `code-review` trên `git diff master...HEAD` (kể cả file chưa stage: `git diff`), theo hai trục: đúng chuẩn repo
   và đúng rubric. Tự kiểm tra thêm:
   - Không còn chỗ nào ép "phải mua hàng mới được chấm sao" (`grep -rn "DELIVERED" src/services/review.service.js`).
   - Mọi `id` trong `renderCheckoutForm` cũ vẫn tồn tại (liệt kê trước/sau để so).
   - Không có chuỗi người dùng nào chèn vào HTML mà thiếu `escapeHtml`.
   - Không sửa file ngoài phạm vi (`git status --short` chỉ gồm file trong các bảng trên + `package-lock.json` có sẵn).
2. Chạy `npm test`: phải **≥ 355 pass, 0 fail** (cộng thêm các test mới). Test fail thì dùng `diagnosing-bugs`.
3. Ghi rõ những gì không kiểm chứng được.

## 6. Kiểm tra trên trình duyệt (agent chính, `PORT=3100`)

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| 1 | Tài khoản mới (chưa có đơn) mở chi tiết sản phẩm → chấm 5 sao | Gửi được; tab thứ 2 thấy ngay (websocket) |
| 2 | Khách (không đăng nhập) bình luận | Gửi được, không có ô chấm sao |
| 3 | Catalog tìm "K2" | Ra Keychron K2; phân trang hiện "1" |
| 4 | Đơn hàng của tôi chỉ có 1 trang | Thấy số "1" |
| 5 | Khách mua 1 sản phẩm, COD, qua 3 bước | Đặt thành công, màn hình thành công như cũ |
| 6 | Người dùng có địa chỉ mặc định, dùng voucher + điểm, chuyển khoản | Bước 1 điền sẵn; bước 3 tóm tắt đúng số tiền |
| 7 | Bước 2 bấm "Đăng nhập" ở khối voucher rồi quay lại | Quay về bước 2, dữ liệu bước 1 còn nguyên |
| 8 | Bỏ trống SĐT, cố đi tiếp | Bị chặn ở bước 1, focus vào ô SĐT |
| 9 | Admin mở trang thanh toán | Vẫn hiện "Admin không thể thanh toán" như cũ |
| 10 | 360px: cả 3 bước | Không tràn ngang, nút đủ lớn |

Thanh toán MoMo/VNPay chỉ thử khi `PAYMENT_ENV=sandbox` đã được cấu hình; nếu chưa, ghi "không kiểm chứng".

## 7. Kết thúc: tóm tắt và **đề xuất** commit (không tự commit)

In báo cáo tiếng Việt gồm:
1. **Tóm tắt thay đổi** theo từng việc (S1-A … S2-D): file đã sửa, hành vi trước/sau.
2. **Kết quả test**: số pass/fail trước và sau, danh sách test mới.
3. **Kết quả kiểm tra trình duyệt**: bảng mục 6 với Đạt / Không đạt / Không kiểm chứng, đường dẫn ảnh chụp.
4. **Rủi ro còn lại** và những gì chưa làm.
5. **Đề xuất commit** đúng quy ước repo, mỗi commit một chủ đề, kèm danh sách file và lệnh `git add` chính xác (không gồm
   `package-lock.json`), ví dụ:

   ```
   fix(review): let any signed-in customer rate a product without a delivered order
     files: src/services/review.service.js, src/repositories/review.repository.js,
            test/product-review.integration.test.js, GLOSSARY.md, docs/specs/vouchers-and-product-reviews.md
   fix(review): drop the "after delivery" hint from the review panel
     files: public/js/product-reviews.js
   fix(shop): always show page numbers on order and voucher lists
   feat(catalog): search products from two characters
   feat(checkout): guide checkout through shipping, payment and confirmation steps
   feat(checkout): remember the checkout step across sign-in redirects
   ```

   Mỗi message kết thúc bằng dòng `Co-Authored-By: Claude <noreply@anthropic.com>`. Dừng lại sau khi in đề xuất và chờ người
   dùng quyết định.
