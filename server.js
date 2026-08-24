// ===== SERVER ENTRY POINT =====
// File này là điểm khởi chạy ứng dụng
// Tách riêng server.js và app.js để dễ testing

require("dotenv").config();

const app = require("./src/app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại: http://localhost:${PORT}`);
});