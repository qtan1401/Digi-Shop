# Lộ trình sprint theo rubric

Cập nhật: 2026-11-18. Bỏ qua phần làm việc nhóm.

Deploy là **điều kiện để bài được chấm** (đề: *"If your team fails to deploy the project ... the submission will not be
graded"*). Hướng đã chốt: PostgreSQL (local) / Neon (production), Cloudinary cho ảnh tải lên, Google Cloud Run nhiều
instance, không Redis, không Docker trên máy.

Prompt điều phối: `docs/sprints/postgres-s3-s5-deploy.prompt.md` (dùng lại mục 2, 3 của `sprint-03-05.prompt.md`).

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Đánh giá không cần mua, phân trang luôn hiện số trang, tìm kiếm từ 2 ký tự | Đã push lên master (`9575e02`) |
| 2 | Checkout 3 bước, nhớ bước qua đăng nhập | Đã push lên master, chưa kiểm tra trên trình duyệt |
| 0 | Mốc an toàn: tag `pre-postgresql`, PostgreSQL 17 cài ở `A:\postgre` | Xong |
| P | Chuyển SQL Server → PostgreSQL, bộ test trên DB thật, hành vi giữ nguyên | Đã push lên master (`98af10e`) |
| 3 | Danh mục và thẻ quản lý được, chuẩn hoá ảnh, thêm sản phẩm để demo phân trang | Đã push lên master (`7cac967`) |
| 4 | Dữ liệu demo trải 2 năm, dashboard nâng cao | Đã push lên master (`7cac967`) |
| 5 | Stateless nhiều instance qua PostgreSQL, Cloudinary, cụm 3 instance local | Tiếp theo, prompt ở `sprint-05-deploy.prompt.md` |
| D | Deploy Cloud Run + Neon + Cloudinary, bằng chứng scaling | Chờ, **chỉ bắt đầu khi người dùng test local xong và nói "bắt đầu deploy"** |
| 6 | Rà soát UI/UX và responsive | Chờ |
| 7 | QA cuối, `Readme.txt` (link, tài khoản), video demo, dọn dẹp | Chờ |

Mỗi giai đoạn có cổng dừng: agent báo cáo và đề xuất commit, người dùng test trên máy và tự quyết định commit trước khi
sang giai đoạn sau.

## Sprint 6: UI/UX và responsive

1. Rà soát 360, 768 và 1280px: trang chủ, catalog, chi tiết, giỏ, checkout, đơn của tôi, admin.
2. Nút và vùng chạm tối thiểu 44px, focus thấy rõ, tương phản đủ, trạng thái loading, rỗng và lỗi.
3. Chỉ sửa CSS và markup, không đổi API.

## Sprint 7: QA cuối

1. Chạy lại toàn bộ rubric trên bản đã deploy, sửa lỗi còn sót.
2. `Readme.txt`: link web, tài khoản admin và khách có dữ liệu sẵn, cách chạy local, ghi chú "lần mở đầu có thể chậm vài
   giây". Thư mục bằng chứng cho scaling.
3. Tuỳ chọn (bonus): GitHub Actions chạy `npm test`.
