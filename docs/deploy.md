# Triển khai Digi-Shop lên Render (Docker) + Neon + Cloudinary

Chạy **một instance** trên gói miễn phí của Render, database trên **Neon** (PostgreSQL), ảnh tải lên trên **Cloudinary**. Giao diện các dịch vụ này có thể đổi tên nút hoặc vị trí: nếu khác với mô tả, tìm mục có ý nghĩa tương đương.

> Bạn tự thao tác trên tài khoản (mật khẩu, xác minh, đồng ý điều khoản). Không gửi chuỗi kết nối, mật khẩu hay khoá API cho agent hoặc đưa vào git.

## Cần biết trước

- **Một instance, có thể ngủ.** Gói free của Render tạm dừng dịch vụ sau khoảng 15 phút không có truy cập; request đầu tiên sau đó mất khoảng một phút để khởi động. Neon cũng ngủ khi rảnh và dậy ở request đầu. Vì vậy **mở link một lần trước buổi chấm**.
- **Bằng chứng scaling (#35)** không nằm trên Render (chỉ 1 instance) mà nằm ở cụm 3 instance chạy trên máy bạn, xem [scaling.md](scaling.md). Ghi rõ điều này trong `Readme.txt` và video.
- **Worker hết hạn thanh toán** chỉ chạy khi dịch vụ đang thức; các Payment attempt quá hạn được quét ngay khi có request đánh thức dịch vụ.
- **Ổ đĩa của Render free không bền.** Ảnh mẫu nằm trong repo nên không mất; ảnh admin tải lên phải ở Cloudinary (đã cấu hình bằng `PRODUCT_IMAGE_STORAGE=cloudinary`).
- Giá và hạn mức thay đổi theo thời điểm: xem lại điều kiện của từng nhà cung cấp trước khi đăng ký.

## 1. Chuẩn bị

1. Đưa code lên GitHub (`master` đã chứa Dockerfile, `render.yaml`). Kiểm tra `.env` và `deploy/*.env` **không** nằm trong repo (`git ls-files | findstr /i "\.env"` chỉ được thấy `.env.example`).
2. Tạo tài khoản **Render**, **Neon**, **Cloudinary** (đăng ký bằng email hoặc GitHub/Google, tự xác minh).
3. Mở `deploy/render.env.example` để theo dõi danh sách biến cần điền.

## 2. Neon (PostgreSQL)

1. Tạo project, vùng **Singapore** (AWS `ap-southeast-1`), PostgreSQL 17 hoặc 16. Tạo một database riêng cho bản này (ví dụ `digishop`).
2. Bấm **Connect**. Lấy **hai chuỗi**:
   - **Pooled** (bật "Connection pooling", host có `-pooler`): dùng cho ứng dụng (`DATABASE_URL`).
   - **Direct** (tắt pooling): chỉ để migrate và seed (`NEON_DIRECT_URL`).
3. Cả hai kết thúc bằng `?sslmode=require`. Giữ chúng riêng tư.

## 3. Cloudinary

Vào **Dashboard** (hoặc Settings → API Keys) và sao chép **API environment variable** dạng `cloudinary://<api-key>:<api-secret>@<cloud-name>`. Đây là `CLOUDINARY_URL`. Ảnh admin tải lên được lưu ở thư mục `digishop/products`; ảnh mẫu vẫn phục vụ từ `/uploads/products`.

## 4. Chọn tên dịch vụ và `APP_ORIGIN`

Địa chỉ Render có dạng `https://<tên-dịch-vụ>.onrender.com`. Tên trong `render.yaml` là `digishop`; nếu tên đó đã bị người khác dùng, Render báo khi tạo: sửa `name:` trong `render.yaml` (hoặc ghi nhớ tên được cấp) rồi dùng đúng địa chỉ cuối cùng cho:

- `APP_ORIGIN` = `https://<tên-dịch-vụ>.onrender.com` (không có `/` ở cuối, không có đường dẫn).
- `VNPAY_IPN_URL` = `<APP_ORIGIN>/api/payments/vnpay/ipn` (nếu dùng VNPay).

Nếu `APP_ORIGIN` sai, trình duyệt sẽ gặp lỗi 403 khi gửi form và đăng nhập (kiểm tra origin/CSRF), và cookie đăng nhập có thể không bật `secure`.

## 5. Migration và seed lên Neon (làm **trước** khi deploy)

Trong PowerShell ở gốc repo, sau `npm ci`:

```powershell
$env:NEON_DIRECT_URL = 'postgresql://...direct...?sslmode=require'
./deploy/migrate-neon.ps1 -Seed
Remove-Item Env:NEON_DIRECT_URL
```

Script áp dụng toàn bộ migration, rồi seed dữ liệu mẫu (sản phẩm, danh mục, thẻ, khoảng 780 đơn trải 2 năm, voucher, đánh giá). Khi seed, script hỏi **mật khẩu admin**: nhập đúng giá trị bạn sẽ đặt cho `ADMIN_DEFAULT_PASSWORD` trên Render (tối thiểu 16 ký tự, không hiện ký tự khi gõ). Script không in output CLI vì lỗi PostgreSQL có thể chứa chuỗi kết nối. Chỉ dùng `-Seed` với database **mới**. Các lần migrate sau bỏ `-Seed`. **Không** chạy `npm run test:db` trên Neon (nó reset database).

## 6. Tạo dịch vụ trên Render bằng Blueprint

1. Render Dashboard → **New → Blueprint** → kết nối GitHub và chọn repo Digi-Shop, nhánh `master`.
2. Render đọc `render.yaml`: một web service `digishop`, runtime Docker, gói **Free**, vùng **Singapore**, health check `/healthz`. Các biến đã có giá trị sẵn (`RATE_LIMIT_STORE=memory`, `REVIEW_EVENTS_MODE=direct`, `PRODUCT_IMAGE_STORAGE=cloudinary`, `PAYMENT_ENV=sandbox`, `TRUST_PROXY=1`, `DB_SSL=true`...). `JWT_ACCESS_SECRET` do Render tự sinh.
3. Render hỏi các biến `sync: false`; điền:

| Biến | Lấy ở đâu |
|---|---|
| `APP_ORIGIN` | Mục 4 |
| `DATABASE_URL` | Neon, chuỗi **pooled** |
| `CLOUDINARY_URL` | Mục 3 |
| `GOOGLE_CLIENT_ID` | Cùng giá trị trong `.env` ở máy |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Cùng giá trị trong `.env` ở máy |
| `ADMIN_DEFAULT_PASSWORD` | Cùng giá trị đã nhập khi seed (mục 5) |

4. Bấm **Apply**. Lần build đầu mất vài phút (Render dựng `Dockerfile`; máy bạn không cần Docker).

Nếu không dùng Blueprint, tạo **New → Web Service**, chọn repo, **Language/Runtime: Docker**, **Region: Singapore**, **Instance type: Free**, **Health Check Path: `/healthz`**, rồi nhập các biến theo bảng ở trên và theo `deploy/render.env.example`.

MoMo và VNPay là tuỳ chọn: bỏ trống thì hai phương thức này không dùng được, COD và chuyển khoản vẫn chạy. Có khoá sandbox thì thêm vào **Environment** sau (xem mục 8).

## 7. Kiểm tra sau khi deploy

1. Mở `https://<tên-dịch-vụ>.onrender.com/healthz`: cần `{"status":"ok","db":"ok",...}` (lần đầu có thể chờ vì Neon dậy; 503 nghĩa là app không nối được DB).
2. Mở trang chủ, `/danh-muc/keyboard?page=2`, tìm kiếm "ban phim".
3. Xem **Logs** trong Render nếu có lỗi khởi động (thiếu biến môi trường được in rõ tên biến).

## 8. Google OAuth và cổng thanh toán sandbox

- **Google:** trong Google Cloud Console → Credentials → OAuth client → **Authorized JavaScript origins**, thêm `https://<tên-dịch-vụ>.onrender.com`. App xác minh Google ID token qua `POST /api/auth/google`, không dùng redirect URI. (Việc này cần dự án Google Cloud có sẵn client ID; không bắt buộc bật billing.)
- **MoMo sandbox:** IPN/callback `POST https://<tên-dịch-vụ>.onrender.com/api/payments/momo/callback`; trang quay về là `.../checkouts.html?paymentAttemptId=...`.
- **VNPay sandbox:** IPN `GET https://<tên-dịch-vụ>.onrender.com/api/payments/vnpay/ipn`.
- Giữ `PAYMENT_ENV=sandbox`. Test mỗi cổng một giao dịch và xác nhận đơn, tồn kho cập nhật đúng một lần.

## 9. Kiểm thử trước buổi chấm

Trên URL công khai: mua hàng khách vãng lai (checkout 3 bước, COD), đăng nhập email và Google, quên mật khẩu, voucher, điểm thưởng, đánh giá realtime (hai tab), admin (sản phẩm, danh mục & thẻ, đơn, người dùng, dashboard năm/quý/tháng/tuần), tải một ảnh sản phẩm (URL phải thuộc `res.cloudinary.com` và còn hiện sau khi deploy lại). Kiểm tra ở 360px.

## 10. Giữ dịch vụ thức (tuỳ chọn)

Để tránh độ trễ lần mở đầu trong buổi chấm, đặt một dịch vụ ping miễn phí (ví dụ UptimeRobot) gọi `/healthz` mỗi 5 phút **chỉ trong thời gian chấm**. Ping liên tục cũng giữ Neon thức và tiêu hao giờ tính toán miễn phí của Neon, nên tắt ping sau đó.

## 11. Sau buổi chấm

Đổi mật khẩu admin bằng chức năng đổi mật khẩu của tài khoản (chỉ đổi biến `ADMIN_DEFAULT_PASSWORD` trên Render không đổi mật khẩu đã seed trong database). Tạo tài khoản demo **chỉ quyền khách hàng** để để link trên CV. Giữ `PAYMENT_ENV=sandbox`. Nếu không còn dùng, xoá dịch vụ trên Render và project Neon.

## 12. Sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Build thất bại ở `npm ci` | `package-lock.json` không khớp `package.json` | Chạy `npm install` rồi commit lockfile; kiểm tra lockfile vẫn chứa các gói `linux` |
| Dịch vụ khởi động rồi dừng, log báo thiếu biến | Chưa điền biến bắt buộc | Điền biến trong Environment, Render tự khởi động lại |
| `/healthz` trả 503 | Sai `DATABASE_URL`, thiếu `DB_SSL=true`, chưa migrate, Neon đang dậy | Kiểm tra pooled URL, chạy lại `migrate-neon.ps1`, thử lại sau vài giây |
| Gửi form/đăng nhập báo 403 | `APP_ORIGIN` khác địa chỉ thật | Sửa `APP_ORIGIN` đúng địa chỉ HTTPS |
| Ảnh admin tải lên biến mất | Chưa đặt `PRODUCT_IMAGE_STORAGE=cloudinary` hoặc `CLOUDINARY_URL` sai | Kiểm tra hai biến |
| Request đầu chậm cả phút | Render và Neon vừa ngủ dậy | Bình thường; mở link trước buổi chấm |
