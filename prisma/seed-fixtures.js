/*
 * Deterministic demo customers, vouchers, orders and product reviews for the local seed.
 *
 * Everything is derived from a fixed PRNG seed and a fixed list of customers, so ids, codes, amounts,
 * comments and the shape of the data are identical on every run. Only timestamps move: they are expressed
 * relative to `now` (the moment the seed module is loaded). The seed never compares timestamps when it
 * decides whether a record is already present, so re-running it later inserts nothing new.
 */

const { NO_EXPIRY_DATE } = require("../src/services/voucher-calculator");
const { POINT_VALUE, earnedPoints, redeemPoints } = require("../src/services/loyalty-calculator");

const SHIPPING_FEE = 100000;
const VOUCHER_MAX_DISCOUNT = 500000;
const ORDER_MAX_DISCOUNT = 1000000;
const MIN_TOTAL = 1000;
const PRNG_SEED = 0x5eed2026;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Shop time is UTC+7 (src/services/admin-period.js). The history starts on a fixed calendar day and runs up to `now`;
// the last 48 hours are the separate RECENT_ORDERS group.
const LOCAL_OFFSET = 7 * HOUR;
const HISTORY_START = Date.UTC(2024, 10, 1) - LOCAL_OFFSET;
const RECENT_WINDOW = 48 * HOUR;

const PAYMENT = {
    COD: "Thanh toán khi nhận hàng (COD)",
    MOMO: "MOMO",
    VNPAY: "VNPAY"
};

const CUSTOMERS = [
    ["Trần Văn Minh", "minh.tran@seed.local", "minh_tran92", "0912345601", "12 Nguyễn Trãi, Thanh Xuân, Hà Nội"],
    ["Nguyễn Thị Hoa", "hoa.nguyen@seed.local", "hoa.nguyen", "0912345602", "45 Lê Lợi, Quận 1, TP. Hồ Chí Minh"],
    ["Vũ Minh Quang", "quang.vu@seed.local", "quangvu", "0912345603", "8 Trần Phú, Hải Châu, Đà Nẵng"],
    ["Lê Thu Trang", "trang.le@seed.local", "trangle_hn", "0912345604", "231 Cầu Giấy, Cầu Giấy, Hà Nội"],
    ["Phạm Đức Anh", "anh.pham@seed.local", "ducanh.pham", "0912345605", "67 Hai Bà Trưng, Ninh Kiều, Cần Thơ"],
    ["Hoàng Thanh Hải", "hai.hoang@seed.local", "haihoang88", "0912345606", "19 Lý Thường Kiệt, Hồng Bàng, Hải Phòng"],
    ["Đặng Ngọc Lan", "lan.dang@seed.local", "lan.dang", "0912345607", "102 Nguyễn Huệ, TP. Huế, Thừa Thiên Huế"],
    ["Bùi Quốc Bảo", "bao.bui@seed.local", "baobui_sg", "0912345608", "58 Võ Văn Tần, Quận 3, TP. Hồ Chí Minh"],
    ["Đỗ Khánh Linh", "linh.do@seed.local", "khanhlinh", "0912345609", "33 Phan Chu Trinh, Nha Trang, Khánh Hòa"],
    ["Ngô Gia Huy", "huy.ngo@seed.local", "giahuy.ngo", "0912345610", "5 Điện Biên Phủ, Bình Thạnh, TP. Hồ Chí Minh"],
    ["Dương Mỹ Duyên", "duyen.duong@seed.local", "myduyen97", "0912345611", "90 Hùng Vương, Buôn Ma Thuột, Đắk Lắk"],
    ["Phan Tuấn Kiệt", "kiet.phan@seed.local", "tuankiet_pn", "0912345612", "14 Quang Trung, Vinh, Nghệ An"]
];

// Customers added after the founding accounts: [name, e-mail local part, username, address]. Their sign-up dates come from
// SIGNUPS_PER_MONTH (a fixed calendar, 2024-11 .. 2026-10) and RECENT_SIGNUP_DAYS_AGO (the last weeks, relative to `now`).
const NEW_CUSTOMERS = [
    ["Nguyễn Hoàng Nam", "nam.nguyen", "namnguyen.hn", "25 Tây Sơn, Đống Đa, Hà Nội"],
    ["Trần Thị Mai Anh", "maianh.tran", "maianh_tran", "76 Nguyễn Thị Minh Khai, Quận 3, TP. Hồ Chí Minh"],
    ["Lê Quang Vinh", "vinh.le", "quangvinh", "14 Bạch Đằng, Hải Châu, Đà Nẵng"],
    ["Phạm Thị Thu Hà", "thuha.pham", "thuha.pham", "52 Lê Hồng Phong, Ngô Quyền, Hải Phòng"],
    ["Võ Minh Tuấn", "tuan.vo", "minhtuan_vo", "8 Nguyễn Văn Linh, Ninh Kiều, Cần Thơ"],
    ["Đặng Thị Bích Ngọc", "ngoc.dang", "bichngoc97", "120 Hoàng Diệu, Quận 4, TP. Hồ Chí Minh"],
    ["Bùi Văn Long", "long.bui", "longbui_bd", "33 Lê Duẩn, Hải Châu, Đà Nẵng"],
    ["Hồ Thị Cẩm Tú", "camtu.ho", "camtu.ho", "61 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội"],
    ["Ngô Đình Khoa", "khoa.ngo", "dinhkhoa", "17 Phan Đình Phùng, TP. Huế, Thừa Thiên Huế"],
    ["Đinh Thị Lan Phương", "lanphuong.dinh", "lanphuong_dt", "9 Nguyễn Chí Thanh, Đống Đa, Hà Nội"],
    ["Lý Gia Bảo", "giabao.ly", "giabao.ly", "204 Cách Mạng Tháng 8, Quận 10, TP. Hồ Chí Minh"],
    ["Dương Thị Thanh Tâm", "thanhtam.duong", "thanhtam.dg", "45 Trần Phú, Nha Trang, Khánh Hòa"],
    ["Huỳnh Văn Sơn", "son.huynh", "sonhuynh89", "77 Võ Thị Sáu, Biên Hòa, Đồng Nai"],
    ["Trịnh Minh Châu", "minhchau.trinh", "chautrinh", "6 Nguyễn Trãi, Thanh Xuân, Hà Nội"],
    ["Mai Văn Thắng", "thang.mai", "thangmai_vt", "91 Lạch Tray, Ngô Quyền, Hải Phòng"],
    ["Phan Thị Hồng Nhung", "hongnhung.phan", "hongnhung_p", "28 Lê Lai, Vinh, Nghệ An"],
    ["Cao Xuân Trường", "truong.cao", "xuantruong.cao", "150 Nguyễn Văn Cừ, Quận 5, TP. Hồ Chí Minh"],
    ["Tạ Thị Ngọc Diệp", "ngocdiep.ta", "diep.ta", "4 Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội"],
    ["Lâm Quốc Đạt", "dat.lam", "quocdat_lam", "39 Hùng Vương, Quy Nhơn, Bình Định"],
    ["Vương Thị Kim Chi", "kimchi.vuong", "kimchi.vg", "18 Trường Chinh, Thanh Khê, Đà Nẵng"],
    ["Nguyễn Đức Thịnh", "thinh.nguyen", "ducthinh_ng", "72 Lý Thái Tổ, Bắc Ninh"],
    ["Trần Bảo Ngọc", "baongoc.tran", "baongoc_t", "11 Phạm Văn Đồng, Cầu Giấy, Hà Nội"],
    ["Lê Văn Hiếu", "hieu.le", "hieule_dn", "205 Ngô Quyền, Sơn Trà, Đà Nẵng"],
    ["Phạm Hồng Phúc", "phuc.pham", "hongphuc.pham", "83 Pasteur, Quận 1, TP. Hồ Chí Minh"],
    ["Võ Thị Mỹ Linh", "mylinh.vo", "mylinh_vo", "26 Hùng Vương, Ninh Kiều, Cần Thơ"],
    ["Đỗ Anh Tú", "tu.do", "anhtu_do", "140 Lê Lợi, Thanh Hóa"],
    ["Hoàng Thị Yến", "yen.hoang", "yenhoang", "54 Nguyễn Tri Phương, TP. Huế, Thừa Thiên Huế"],
    ["Bùi Minh Hoàng", "hoang.bui", "minhhoang_b", "31 Trần Quang Khải, Hoàn Kiếm, Hà Nội"],
    ["Ngô Thị Thu Thảo", "thuthao.ngo", "thuthao.ngo", "62 Nguyễn Đình Chiểu, Quận 3, TP. Hồ Chí Minh"],
    ["Đào Văn Tiến", "tien.dao", "tiendao_hp", "15 Điện Biên Phủ, Hồng Bàng, Hải Phòng"],
    ["Lương Thị Hải Yến", "haiyen.luong", "haiyen_l", "99 Yersin, Đà Lạt, Lâm Đồng"],
    ["Châu Quốc Huy", "quochuy.chau", "huychau", "47 Phan Bội Châu, Buôn Ma Thuột, Đắk Lắk"],
    ["Từ Thị Diễm My", "diemmy.tu", "diemmy_tu", "10 Nguyễn Văn Trỗi, Phú Nhuận, TP. Hồ Chí Minh"],
    ["Kiều Văn Dũng", "dung.kieu", "dungkieu", "68 Trần Nhân Tông, Hai Bà Trưng, Hà Nội"],
    ["Thái Thị Bảo Trâm", "baotram.thai", "baotram_t", "5 Nguyễn Công Trứ, Vũng Tàu, Bà Rịa - Vũng Tàu"],
    ["Quách Minh Khôi", "khoi.quach", "minhkhoi_q", "120 Lê Văn Sỹ, Quận 3, TP. Hồ Chí Minh"],
    ["Tô Thị Phương Anh", "phuonganh.to", "phuonganh_to", "22 Trần Phú, Hà Đông, Hà Nội"],
    ["Lại Văn Quyết", "quyet.lai", "quyetlai", "85 Nguyễn Huệ, Biên Hòa, Đồng Nai"],
    ["Văn Thị Ngân", "ngan.van", "nganvan_hue", "7 Lê Lợi, TP. Huế, Thừa Thiên Huế"],
    ["Đoàn Quốc Anh", "quocanh.doan", "quocanh_d", "130 Lê Hồng Phong, Quận 5, TP. Hồ Chí Minh"],
    ["Nghiêm Thị Hạnh", "hanh.nghiem", "hanhnghiem", "3 Tôn Đức Thắng, Đống Đa, Hà Nội"],
    ["La Văn Phong", "phong.la", "phongla_cm", "44 Quang Trung, Cà Mau"],
    ["Triệu Thị Quỳnh", "quynh.trieu", "quynhtrieu", "58 Lê Thánh Tông, Hải Châu, Đà Nẵng"],
    ["Mạc Đăng Khoa", "dangkhoa.mac", "dangkhoa_m", "16 Nguyễn Thái Học, Hạ Long, Quảng Ninh"],
    ["Âu Thị Thùy Dung", "thuydung.au", "thuydung_au", "92 Hoàng Văn Thụ, Tân Bình, TP. Hồ Chí Minh"],
    ["Diệp Văn Lộc", "loc.diep", "locdiep88", "37 Nguyễn Du, Rạch Giá, Kiên Giang"],
    ["Khúc Thị Hồng Hạnh", "honghanh.khuc", "honghanh_k", "21 Phan Chu Trinh, Hoàn Kiếm, Hà Nội"],
    ["Chu Minh Đức", "duc.chu", "minhduc_chu", "9 Lê Lợi, Thái Nguyên"]
];

// New sign-ups per calendar month from 2024-11 to 2026-10, with spikes: Black Friday, back-to-school, the start of each year.
const SIGNUPS_PER_MONTH = [2, 2, 3, 1, 1, 1, 1, 3, 2, 2, 1, 1, 4, 1, 3, 1, 1, 1, 1, 3, 2, 2, 1, 2];
// The last few sign-ups are relative to `now`, so the "new customers this week" figure is never empty.
const RECENT_SIGNUP_DAYS_AGO = [28, 21, 14, 9, 5, 3];
const PHONE_PREFIXES = ["90", "93", "97", "98", "86", "70", "77", "89"];
const newCustomerPhone = (position) => `0${PHONE_PREFIXES[position % PHONE_PREFIXES.length]}${String(2000000 + position * 137931).slice(0, 7)}`;

// Every customer as [name, email, username, phone, address]: the 12 founding accounts, then the generated ones.
const CUSTOMER_ROWS = [
    ...CUSTOMERS,
    ...NEW_CUSTOMERS.map(([name, local, username, address], position) => [name, `${local}@seed.local`, username, newCustomerPhone(position), address])
];
if (CUSTOMER_ROWS.length !== CUSTOMERS.length + SIGNUPS_PER_MONTH.reduce((sum, count) => sum + count, 0) + RECENT_SIGNUP_DAYS_AGO.length) {
    throw new Error("Seed customers and their sign-up schedule must have the same length");
}

// A second saved address for a few customers, so the address book and the checkout selector have more than one entry.
// Keyed by customer position; the customer's own contact details (CUSTOMERS) are their default address.
const EXTRA_ADDRESSES = new Map([
    [0, ["Trần Thị Mai", "0987654301", "27 Kim Mã, Ba Đình, Hà Nội"]],
    [1, ["Nguyễn Văn Long", "0987654302", "310 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh"]],
    [4, ["Phạm Thu Hà", "0987654305", "15 Nguyễn Văn Cừ, Ninh Kiều, Cần Thơ"]],
    [14, ["Trần Văn Hùng", "0987654315", "88 Nguyễn Trãi, Thanh Xuân, Hà Nội"]],
    [30, ["Lê Thị Hạnh", "0987654331", "12 Trần Quốc Toản, Hải Châu, Đà Nẵng"]]
]);

const CUSTOMER_NOTES = [
    "Giao giờ hành chính giúp mình.",
    "Gọi trước khi giao 15 phút.",
    "Giao cho bảo vệ nếu mình không có nhà.",
    "Xuất hóa đơn công ty giúp mình.",
    "Đóng gói kỹ giúp mình, cảm ơn shop."
];

// Codes are 5 letters/digits, usage limit is at most 10, and nothing expires (course spec).
// `from`: days relative to `now`, or null for "since the shop opened" (the first day of the order history).
const VOUCHER_DEFINITIONS = [
    { code: "NEW10", description: "Giảm 10%, tối đa 200.000₫", type: "PERCENT", percent: 10, maxDiscount: 200000, from: null, quantity: 10, enabled: true, listed: true },
    { code: "SALE5", description: "Giảm 5%, tối đa 500.000₫", type: "PERCENT", percent: 5, maxDiscount: 500000, from: null, quantity: 10, enabled: true, listed: true },
    { code: "FSHIP", description: "Miễn phí vận chuyển cho mọi đơn hàng", type: "FREE_SHIPPING", percent: null, maxDiscount: null, from: null, quantity: 10, enabled: true, listed: true },
    { code: "OFF15", description: "Giảm 15%, tối đa 300.000₫", type: "PERCENT", percent: 15, maxDiscount: 300000, from: -30, quantity: 10, enabled: true, listed: true },
    { code: "OFF20", description: "Giảm 20%, tối đa 400.000₫", type: "PERCENT", percent: 20, maxDiscount: 400000, from: null, quantity: 10, enabled: true, listed: true },
    { code: "PAUSE", description: "Giảm 8%, tối đa 150.000₫ — tạm ngưng", type: "PERCENT", percent: 8, maxDiscount: 150000, from: null, quantity: 10, enabled: false, listed: true },
    { code: "FULL3", description: "Giảm 12%, tối đa 250.000₫ — đã hết lượt", type: "PERCENT", percent: 12, maxDiscount: 250000, from: null, quantity: 3, enabled: true, listed: true },
    { code: "VIP25", description: "Giảm 25%, tối đa 500.000₫ — mã riêng cho khách VIP", type: "PERCENT", percent: 25, maxDiscount: 500000, from: null, quantity: 10, enabled: true, listed: false }
];

// Voucher uses spread over the history. `at` is a position (0..1) in the chronological list of historical orders,
// `daysAgo` a position relative to `now`; the nearest still-unused DELIVERED order (CANCELLED when `cancelled`) takes it.
// A use is skipped when it would pass the voucher's usage limit, so the limits come from VOUCHER_DEFINITIONS, not from here.
const VOUCHER_PLAN = [
    { at: 0.02, codes: ["NEW10"] },
    { at: 0.05, codes: ["FULL3"] },
    { at: 0.08, codes: ["SALE5"] },
    { at: 0.11, codes: ["NEW10", "FSHIP"] },
    { at: 0.15, codes: ["OFF20"] },
    { at: 0.19, codes: ["FULL3"] },
    { at: 0.22, codes: ["VIP25", "NEW10", "FSHIP"] },
    { at: 0.26, codes: ["SALE5"] },
    { at: 0.29, codes: ["OFF20"] },
    { at: 0.33, codes: ["NEW10"] },
    { at: 0.36, codes: ["FSHIP"] },
    { at: 0.4, codes: ["FULL3"] },
    { at: 0.43, codes: ["SALE5", "FSHIP"] },
    { at: 0.47, codes: ["OFF20"] },
    { at: 0.51, codes: ["VIP25"] },
    { at: 0.54, codes: ["NEW10"], cancelled: true },
    { at: 0.57, codes: ["SALE5"] },
    { at: 0.6, codes: ["OFF20", "FSHIP"] },
    { at: 0.64, codes: ["NEW10"] },
    { at: 0.67, codes: ["VIP25"] },
    { at: 0.7, codes: ["SALE5"] },
    { at: 0.73, codes: ["OFF20"] },
    { at: 0.76, codes: ["NEW10", "FSHIP"] },
    { at: 0.79, codes: ["FSHIP"] },
    { at: 0.82, codes: ["VIP25"] },
    { at: 0.85, codes: ["OFF20"] },
    { at: 0.88, codes: ["SALE5"] },
    { at: 0.9, codes: ["NEW10"] },
    { at: 0.92, codes: ["VIP25"] },
    { at: 0.94, codes: ["FSHIP"] },
    { at: 0.96, codes: ["SALE5"] },
    { at: 0.97, codes: ["OFF20"] },
    // OFF15 only became valid 30 days ago.
    { daysAgo: 25, codes: ["OFF15"] },
    { daysAgo: 18, codes: ["OFF15"] },
    { daysAgo: 9, codes: ["OFF15"] }
];

// Recent orders (last 48 hours): status mix, with at least one stale unpaid COD and one stale paid MOMO/VNPAY PENDING order.
const RECENT_ORDERS = [
    { hoursAgo: 46, method: "MOMO", orderStatus: "SHIPPED", paymentStatus: "PAID", vouchers: [] },
    { hoursAgo: 36, method: "VNPAY", orderStatus: "CANCELLED", paymentStatus: "REFUNDED", vouchers: ["SALE5"] },
    { hoursAgo: 30, method: "COD", orderStatus: "PENDING", paymentStatus: "UNPAID", vouchers: [] },
    { hoursAgo: 27, method: "MOMO", orderStatus: "PENDING", paymentStatus: "PAID", vouchers: [] },
    { hoursAgo: 20, method: "VNPAY", orderStatus: "PROCESSING", paymentStatus: "PAID", vouchers: [] },
    { hoursAgo: 10, method: "COD", orderStatus: "CANCELLED", paymentStatus: "UNPAID", vouchers: [] },
    { hoursAgo: 5, method: "COD", orderStatus: "PENDING", paymentStatus: "UNPAID", vouchers: [] },
    { hoursAgo: 3, method: "COD", orderStatus: "PROCESSING", paymentStatus: "UNPAID", vouchers: [] }
];

// Per-product rating patterns by product id; `null` = no reviews, "COMMENT_ONLY" = text reviews without stars.
const REVIEW_PROFILES = {
    301: [5, 5, 5, 4, 5, 5, 4, 5],
    302: [4, 1, 5, 2, 4, 3, 4, 5],
    303: [3, 4, 4, 3, 4, 3, 5, 4],
    304: [4, 5, 4, 4, 5, 4, 3, 5],
    305: [3, 4, 3, 2, 4, 3, 4, 3],
    401: [5, 5, 4, 5, 5, 5, 4, 5],
    402: [4, 3, 4, 3, 5, 4, 3, 4],
    403: [5, 5, 5, 4, 5, 5, 5, 4],
    404: [4, 5, 4, 4, 5, 3, 4, 5],
    405: "COMMENT_ONLY",
    406: [4, 5, 4, 5, 4, 4, 5, 3],
    407: [4, 5, 4, 4, 5, 3, 5, 4],
    408: [5, 4, 5, 4, 5, 4, 4, 5],
    409: [4, 4, 5, 3, 4, 4, 5, 4],
    410: [5, 5, 4, 5, 4, 5, 5, 4],
    411: [4, 5, 4, 3, 4, 5, 4, 4],
    412: [5, 4, 5, 5, 4, 4, 5, 4],
    413: [4, 3, 4, 5, 4, 3, 4, 5],
    414: [5, 4, 5, 4, 5, 4, 5, 5],
    501: [5, 5, 4, 5, 5, 5, 5, 4],
    502: [4, 3, 4, 4, 3, 4, 5, 3],
    503: [4, 4, 5, 3, 4, 5, 4, 4],
    504: null,
    505: [5, 4, 5, 4, 4, 5, 4, 5],
    506: [4, 5, 4, 4, 3, 5, 4, 4],
    507: [4, 4, 3, 5, 4, 4, 5, 3],
    508: [5, 5, 4, 5, 4, 5, 4, 5],
    509: [4, 3, 4, 4, 5, 3, 4, 4],
    510: [5, 4, 5, 5, 4, 5, 4, 5],
    511: [4, 5, 4, 4, 5, 4, 3, 5],
    512: [4, 3, 4, 5, 4, 3, 4, 4],
    513: [5, 4, 5, 4, 4, 5, 5, 4],
    514: [4, 3, 5, 4, 3, 4, 4, 5],
    601: [5, 5, 4, 5, 5, 5, 4, 5],
    602: [4, 5, 4, 4, 5, 3, 4, 5],
    603: [4, 5, 4, 5, 4, 4, 5, 3],
    701: [4, 4, 5, 3, 4, 5, 4, 4],
    702: [5, 5, 4, 5, 5, 5, 5, 4],
    703: [4, 3, 4, 3, 5, 4, 3, 4],
    704: [5, 5, 5, 4, 5, 5, 5, 4],
    801: [5, 5, 4, 5, 5, 5, 4, 5],
    802: [4, 5, 4, 4, 5, 3, 4, 5]
};

const COMMENTS = {
    positive: {
        laptop: [
            "Hiệu năng mạnh, làm việc đồ họa và code đều mượt, quạt chạy êm.",
            "Pin dùng được cả ngày làm việc văn phòng, rất đáng tiền.",
            "Màn hình đẹp, độ sáng cao, làm việc ngoài trời vẫn nhìn rõ.",
            "Bàn phím gõ êm, touchpad nhạy, dùng cả ngày không mỏi tay.",
            "Máy nhẹ, thiết kế gọn, mang đi công tác rất thuận tiện.",
            "Tản nhiệt tốt, chơi game vài tiếng máy vẫn mát và ổn định.",
            "Khởi động nhanh, mở ứng dụng nặng gần như tức thì."
        ],
        keyboard: [
            "Gõ rất êm và sướng tay, âm thanh trầm đầm, dùng cả ngày không mỏi.",
            "Kết nối ổn định, chuyển giữa máy tính và laptop chỉ một phím bấm.",
            "Hoàn thiện chắc chắn, keycap dày, đèn nền đẹp và không bị chói.",
            "Pin trâu, dùng cả tuần mới phải sạc, rất tiện khi làm việc.",
            "Layout gọn nên bàn làm việc rộng hơn hẳn, vẫn đủ phím mũi tên.",
            "Thay switch dễ dàng, mình tự đổi theo ý thích rất vui.",
            "Phím bấm đều, không bị kẹt hay ngã phím sau nhiều tuần dùng."
        ],
        mouse: [
            "Cầm vừa tay, di chuột chính xác, dùng cả ngày không bị mỏi cổ tay.",
            "Cảm biến nhạy, trượt mượt trên mọi bề mặt, chơi game rất đã.",
            "Pin dùng được rất lâu, sạc nhanh, kết nối không dây không bị trễ.",
            "Phím bấm chắc tay, nhẹ và êm, làm việc văn phòng rất thích.",
            "Thiết kế đẹp, nhẹ, chơi game bắn súng aim chuẩn hơn hẳn chuột cũ.",
            "Bánh xe cuộn mượt, tùy chỉnh phím qua phần mềm rất tiện lợi.",
            "Ghép nối nhanh với nhiều máy, chuyển đổi gần như tức thì."
        ],
        headphone: [
            "Âm thanh rõ ràng, chi tiết, nghe nhạc và chơi game đều rất đã tai.",
            "Đeo thoải mái hàng giờ liền, đệm tai mềm và không bị nóng tai.",
            "Micro thu giọng rõ, bạn bè nghe rất sạch khi chơi game và họp online.",
            "Pin dùng được rất lâu, kết nối không dây ổn định không bị rớt.",
            "Chống ồn tốt, đi làm hay ở quán cà phê đều tập trung được.",
            "Thiết kế sang, chất liệu chắc chắn, hoàn thiện rất tốt.",
            "Định vị âm thanh chính xác, nghe rõ bước chân trong game bắn súng."
        ],
        monitor: [
            "Màn hình đẹp, màu sắc tươi và chuẩn, chơi game và xem phim đều đã mắt.",
            "Tần số quét cao nên chuyển động rất mượt, chơi game bắn súng không bị xé hình.",
            "Viền mỏng, chân đế chỉnh được nhiều hướng, đặt lên bàn rất gọn.",
            "Độ phân giải QHD nét hơn Full HD rõ rệt, làm việc nhiều cửa sổ rất tiện.",
            "Màu sắc chuẩn, làm việc chỉnh ảnh không cần hiệu chỉnh thêm nhiều.",
            "Một dây USB-C vừa xuất hình vừa sạc laptop, bàn làm việc gọn hẳn."
        ],
        storage: [
            "Tốc độ sao chép rất nhanh, chép cả thư mục phim 4K chỉ trong vài chục giây.",
            "Nhỏ gọn, chắc chắn, bỏ túi mang đi lại không lo va đập.",
            "Chạy ổn định, nhiệt độ thấp, tải game và mở project nặng rất nhanh.",
            "Cắm vào là nhận ngay trên cả laptop lẫn điện thoại, không cần cài đặt gì.",
            "Dung lượng rộng rãi, giá hợp lý so với tốc độ nhận được.",
            "Lắp vào máy là cảm nhận ngay thời gian khởi động giảm hẳn."
        ],
        general: [
            "Giao hàng nhanh, đóng gói cẩn thận, hộp còn nguyên seal.",
            "Giá tốt hơn nhiều nơi khác, nhân viên tư vấn nhiệt tình.",
            "Đóng gói chắc chắn, có chống sốc kỹ, nhận hàng không trầy xước.",
            "Shop giao đúng hẹn, sản phẩm chính hãng, đầy đủ phụ kiện.",
            "Sản phẩm đúng như mô tả, dùng rất ưng, sẽ ủng hộ shop tiếp.",
            "Bảo hành rõ ràng, shop hỗ trợ nhanh khi mình cần hỏi.",
            "Mua với giá hợp lý, chất lượng vượt mong đợi.",
            "Giao hàng trong ngày, kiểm tra hàng kỹ trước khi nhận, rất yên tâm."
        ]
    },
    neutral: {
        laptop: [
            "Hiệu năng ổn, nhưng quạt hơi ồn khi chạy tác vụ nặng.",
            "Màn hình tạm được, pin dùng khoảng nửa ngày văn phòng.",
            "Máy chạy tốt, nhưng thân máy hơi nóng khi sạc và làm việc lâu."
        ],
        keyboard: [
            "Gõ ổn, nhưng âm thanh hơi vọng và cần chỉnh lại một chút mới ưng.",
            "Bàn phím tốt, tuy nhiên đèn nền ở một vài phím hơi lệch sáng.",
            "Pin dùng được vài ngày, mong thời lượng pin dài hơn khi bật đèn."
        ],
        mouse: [
            "Chuột dùng ổn, nhưng hơi nhỏ so với bàn tay mình, cầm lâu hơi mỏi.",
            "Cảm biến tốt, tuy nhiên phần mềm tùy chỉnh hơi nặng và khó làm quen.",
            "Phím bấm ổn, giá hơi cao so với các chuột cùng phân khúc."
        ],
        headphone: [
            "Âm thanh tốt nhưng đeo lâu hơn hai tiếng thì hơi nóng tai.",
            "Micro thu ổn trong phòng yên tĩnh, nơi ồn thì còn lẫn tiếng nền.",
            "Pin dùng được, nhưng kết nối thỉnh thoảng bị ngắt nhẹ khi đi xa máy."
        ],
        monitor: [
            "Màn hình đẹp nhưng loa trong chỉ ở mức tạm, nên mua thêm loa ngoài.",
            "Màu sắc tốt, tuy nhiên độ sáng hơi thấp khi đặt gần cửa sổ.",
            "Dùng ổn, giá hơi cao so với cấu hình nhưng chất lượng chấp nhận được."
        ],
        storage: [
            "Tốc độ tốt, nhưng khi chép tệp lớn liên tục thì tốc độ có giảm xuống.",
            "Ổ chạy ổn, nhưng nhiệt độ hơi nóng khi chép dữ liệu nhiều.",
            "Giá hơi cao so với dung lượng, nhưng đổi lại độ bền và tốc độ tốt."
        ],
        general: [
            "Sản phẩm tốt, nhưng giao hàng chậm hơn dự kiến một ngày.",
            "Đóng gói ổn, hộp hơi móp góc nhưng sản phẩm không sao.",
            "Giá chấp nhận được, mong shop có thêm nhiều ưu đãi hơn.",
            "Dùng ổn so với tầm giá, chưa có điểm nào quá nổi bật."
        ]
    },
    negative: {
        laptop: [
            "Quạt ồn và máy nóng khi dùng lâu, hiệu năng không như kỳ vọng.",
            "Pin không được lâu, chỉ khoảng 3 tiếng dùng thực tế.",
            "Bản lề hơi lỏng sau một thời gian, mong shop hỗ trợ bảo hành."
        ],
        keyboard: [
            "Dùng vài tuần thì một phím bị double-click, mong hãng cải thiện chất lượng.",
            "Kết nối Bluetooth hay bị rớt, phải ghép nối lại nhiều lần."
        ],
        mouse: [
            "Con lăn bị kêu lọc cọc sau một thời gian ngắn dùng, hơi thất vọng.",
            "Pin tụt nhanh hơn quảng cáo, mình phải sạc gần như mỗi ngày."
        ],
        headphone: [
            "Đệm tai bị xẹp sau vài tuần, đeo lâu bị đau tai.",
            "Micro thu nhỏ và hay bị rè, không như mong đợi ở tầm giá này."
        ],
        monitor: [
            "Màn hình bị hở sáng nhẹ ở góc, mình đã liên hệ shop để kiểm tra.",
            "Có vài điểm sáng nhỏ trên màn hình khi nhận hàng, hơi tiếc."
        ],
        storage: [
            "Ổ nóng nhanh khi chép dữ liệu lớn và tốc độ tụt rõ rệt sau đó.",
            "Không nhận ở một số cổng USB, phải đổi cáp mới chạy được."
        ],
        general: [
            "Giao hàng chậm hơn hẹn tận 3 ngày, đóng gói sơ sài.",
            "Giá cao hơn một vài nơi khác mà mình tìm thấy.",
            "Hộp có dấu hiệu bị mở trước khi giao, mình hơi lo lắng.",
            "Phụ kiện đi kèm thiếu một món, phải liên hệ shop nhiều lần."
        ]
    }
};

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createRandom(seed) {
    const next = mulberry32(seed);
    const int = (limit) => Math.floor(next() * limit);
    const pick = (items) => items[int(items.length)];
    const shuffle = (items) => {
        const copy = [...items];
        for (let index = copy.length - 1; index > 0; index -= 1) {
            const swap = int(index + 1);
            [copy[index], copy[swap]] = [copy[swap], copy[index]];
        }
        return copy;
    };
    return { next, int, pick, shuffle };
}

/** Takes `excess` away from the given amounts, last voucher first, so the per-voucher amounts still sum exactly. */
function trimFromLast(amounts, indexes, excess) {
    let remaining = excess;
    for (let position = indexes.length - 1; position >= 0 && remaining > 0; position -= 1) {
        const index = indexes[position];
        const taken = Math.min(amounts[index], remaining);
        amounts[index] -= taken;
        remaining -= taken;
    }
}

/** Voucher rules from docs/specs/vouchers-and-product-reviews.md (rules 1-7), in whole VND. */
function calculateSeedDiscounts(subtotal, shippingFee, vouchers) {
    const amounts = vouchers.map((voucher) => voucher.type === "PERCENT"
        ? Math.min(Math.floor((subtotal * voucher.percent) / 100), voucher.maxDiscount, VOUCHER_MAX_DISCOUNT)
        : Math.min(shippingFee, VOUCHER_MAX_DISCOUNT));
    const goods = vouchers.map((voucher, index) => (voucher.type === "PERCENT" ? index : -1)).filter((index) => index >= 0);
    const goodsTotal = goods.reduce((sum, index) => sum + amounts[index], 0);
    trimFromLast(amounts, goods, goodsTotal - subtotal);
    const all = vouchers.map((_, index) => index);
    const allowed = Math.min(ORDER_MAX_DISCOUNT, subtotal + shippingFee - MIN_TOTAL);
    trimFromLast(amounts, all, amounts.reduce((sum, amount) => sum + amount, 0) - Math.max(0, allowed));
    return amounts;
}

const money = (value) => `${value}.00`;
const iso = (milliseconds) => new Date(milliseconds).toISOString();

const userIdFor = (index) => `5eed0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const addressIdFor = (index, position) => `5eed0000-0000-4000-9000-${String(index + 1).padStart(6, "0")}${String(position).padStart(6, "0")}`;

const shopTime = (year, month, day, hour = 0, minute = 0) => Date.UTC(year, month, day, hour, minute) - LOCAL_OFFSET;

/** Sign-up instants of every customer, in customer order: founding accounts, the calendar schedule, the last weeks. */
function buildSignupTimes(reference) {
    const random = createRandom(PRNG_SEED ^ 0xc0de);
    // The founding accounts open the shop on its first morning.
    const times = CUSTOMERS.map((_, index) => HISTORY_START + 10 * 60 * 1000 + index * 20 * 60 * 1000);
    SIGNUPS_PER_MONTH.forEach((count, monthIndex) => {
        const year = 2024 + Math.floor((10 + monthIndex) / 12);
        const month = (10 + monthIndex) % 12;
        const inMonth = Array.from({ length: count }, () => shopTime(year, month, 1 + random.int(27), 8 + random.int(14), random.int(60)));
        times.push(...inMonth.sort((left, right) => left - right));
    });
    for (const daysAgo of RECENT_SIGNUP_DAYS_AGO) times.push(reference - daysAgo * DAY - random.int(10) * HOUR);
    return times;
}

function buildUsers(reference) {
    const signups = buildSignupTimes(reference);
    return CUSTOMER_ROWS.map(([name, email, username, phone, address], index) => {
        const createdAt = signups[index];
        const extra = EXTRA_ADDRESSES.get(index);
        return {
            id: userIdFor(index),
            email,
            username,
            fullName: name,
            role: "user",
            status: "ACTIVE",
            emailVerifiedAt: iso(createdAt + 5 * 60 * 1000),
            // Balance = points of the orders credited so far minus those redeemed; set by creditLoyalty once the orders exist.
            loyaltyPoints: 0,
            addresses: [
                { id: addressIdFor(index, 1), recipientName: name, phone, addressLine: address, isDefault: true, createdAt: iso(createdAt + 10 * 60 * 1000) },
                ...(extra ? [{ id: addressIdFor(index, 2), recipientName: extra[0], phone: extra[1], addressLine: extra[2], isDefault: false, createdAt: iso(createdAt + 20 * 60 * 1000) }] : [])
            ],
            createdAt: iso(createdAt),
            updatedAt: iso(createdAt + 5 * 60 * 1000)
        };
    });
}

function buildVouchers(reference) {
    return VOUCHER_DEFINITIONS.map((definition) => {
        const startsAt = definition.from === null ? HISTORY_START : reference + definition.from * DAY;
        return {
            code: definition.code,
            description: definition.description,
            type: definition.type,
            percent: definition.percent,
            maxDiscount: definition.maxDiscount === null ? null : money(definition.maxDiscount),
            startsAt: iso(startsAt),
            endsAt: NO_EXPIRY_DATE.toISOString(),
            quantity: definition.quantity,
            redeemedCount: 0,
            isEnabled: definition.enabled,
            isListed: definition.listed,
            createdAt: iso(startsAt),
            updatedAt: iso(startsAt)
        };
    });
}

// ── Order history ─────────────────────────────────────────────────────────────
// One PRNG stream per calendar day (seeded from PRNG_SEED and the day number), so every day before the last 48 hours
// is identical whatever `now` is: a later run only appends days and shifts the recent timestamps.

// Seasonality: back-to-school (Jun-Aug), Black Friday (Nov), Tet shopping (Dec-Jan).
const MONTH_WEIGHTS = [1.3, 1.05, 0.8, 0.8, 0.85, 1.2, 1.4, 1.45, 1, 0.85, 1.5, 1.3];
const ORDERS_PER_WEIGHT = 25;
// The shop is growing: 2024 is only Nov-Dec of a young shop, 2026 is a full 35% above 2025.
const yearFactor = (year) => (year <= 2024 ? 0.7 : year === 2025 ? 1 : 1.35 * 1.08 ** (year - 2026));
const HOUR_WEIGHTS = [3, 5, 6, 5, 4, 4, 4, 4, 5, 6, 7, 8, 8, 6, 4, 2]; // 08:00-23:59 shop time
const HOUR_WEIGHT_TOTAL = HOUR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

// Share of orders that redeem points, and the most of an order's payable amount points may cover.
const POINTS_USE_RATE = 0.16;
const POINTS_MAX_SHARE = 0.4;

// Popularity: cheap peripherals sell the most units, laptops and monitors few units at a high price.
const DEVICE_WEIGHTS = { mouse: 3, keyboard: 2.4, storage: 2, headphone: 1.8, monitor: 1.7, laptop: 1.7 };
const POPULARITY = { 507: 2.2, 514: 1.9, 502: 1.7, 402: 1.5, 408: 1.5, 407: 1.3, 513: 1.3, 301: 1.5, 302: 1.3, 801: 1.4, 701: 1.2 };

const lastFridayOfNovember = (year) => 30 - ((new Date(Date.UTC(year, 10, 30)).getUTCDay() + 2) % 7);

const monthPlans = new Map();
/** Relative weight of each day of a month: weekends, 11.11, 12.12 and the Black Friday weekend sell more. */
function monthPlan(year, month) {
    const key = year * 12 + month;
    if (!monthPlans.has(key)) {
        const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const blackFriday = month === 10 ? lastFridayOfNovember(year) : 0;
        const weights = Array.from({ length }, (_, offset) => {
            const day = offset + 1;
            const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
            let weight = weekday === 6 ? 1.15 : weekday === 0 ? 1.1 : 1;
            if (month === 10 && day === 11) weight *= 2.5;
            if (month === 11 && day === 12) weight *= 2;
            if (blackFriday && day >= blackFriday && day <= blackFriday + 3) weight *= [4, 2.2, 1.8, 2][day - blackFriday];
            return weight;
        });
        monthPlans.set(key, { weights, total: weights.reduce((sum, weight) => sum + weight, 0) });
    }
    return monthPlans.get(key);
}

function dailyOrderCount(year, month, day, random) {
    const plan = monthPlan(year, month);
    const expected = (MONTH_WEIGHTS[month] * yearFactor(year) * ORDERS_PER_WEIGHT * plan.weights[day - 1]) / plan.total;
    const whole = Math.floor(expected);
    return whole + (random.next() < expected - whole ? 1 : 0);
}

function pickOrderTime(random) {
    let roll = random.next() * HOUR_WEIGHT_TOTAL;
    let hour = 0;
    while (hour < HOUR_WEIGHTS.length - 1 && roll >= HOUR_WEIGHTS[hour]) {
        roll -= HOUR_WEIGHTS[hour];
        hour += 1;
    }
    return (8 + hour) * HOUR + random.int(3600) * 1000;
}

/** Index of a weighted pick among the entries not in `taken` (weights <= 0 never win). */
function pickWeighted(weights, random, taken = null) {
    let total = 0;
    for (let index = 0; index < weights.length; index += 1) if (!taken?.has(index)) total += weights[index];
    let roll = random.next() * total;
    let last = -1;
    for (let index = 0; index < weights.length; index += 1) {
        if (taken?.has(index) || weights[index] <= 0) continue;
        last = index;
        if (roll < weights[index]) return index;
        roll -= weights[index];
    }
    return last;
}

/** Per-month selling weight of every product (index = month). */
function buildProductWeights(products) {
    const random = createRandom(PRNG_SEED ^ 0x9d0d);
    const base = products.map((product) => (DEVICE_WEIGHTS[product.deviceType] || 1) * (POPULARITY[product.id] || 1) * (0.75 + 0.5 * random.next()));
    const seasonal = (month, deviceType) => {
        if (month >= 5 && month <= 7 && deviceType === "laptop") return 1.6; // back-to-school
        if (month === 10 && (deviceType === "monitor" || deviceType === "headphone")) return 1.4; // Black Friday
        return 1;
    };
    return Array.from({ length: 12 }, (_, month) => products.map((product, index) => base[index] * seasonal(month, product.deviceType)));
}

function pickBasket(products, weights, random) {
    const roll = random.next();
    const size = roll < 0.58 ? 1 : roll < 0.88 ? 2 : 3;
    const accessories = weights.map((weight, index) => (["mouse", "keyboard"].includes(products[index].deviceType) ? weight : 0));
    const taken = new Set();
    const basket = [];
    while (basket.length < size) {
        // A laptop buyer usually adds a mouse or keyboard.
        const withLaptop = basket.length > 0 && products[basket[0]].deviceType === "laptop";
        const index = pickWeighted(withLaptop ? accessories : weights, random, taken);
        taken.add(index);
        basket.push(index);
    }
    return basket;
}

function buildItems(products, productIndexes, random) {
    return productIndexes.map((productIndex) => {
        const active = products[productIndex].variants.filter((variant) => variant.isActive !== false);
        const variant = random.pick(active.length > 0 ? active : products[productIndex].variants);
        const price = Number(variant.price);
        const roll = random.next();
        let quantity = 1;
        if (price < 1500000) quantity = roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3;
        else if (price < 5000000) quantity = roll < 0.75 ? 1 : 2;
        else if (price < 10000000) quantity = roll < 0.9 ? 1 : 2;
        return { variantSku: variant.sku, unitPrice: money(price), quantity, lineTotal: money(price * quantity), productId: products[productIndex].id };
    });
}

/** Stable per-customer ordering appetite: a few loyal customers order often, most only now and then. */
function buildCustomerPool(users) {
    const random = createRandom(PRNG_SEED ^ 0x5a17);
    return users.map((user, index) => ({ index, createdAt: Date.parse(user.createdAt), weight: 0.4 + 3 * random.next() ** 2 }));
}

const pickMethod = (roll) => (roll < 0.5 ? "COD" : roll < 0.78 ? "MOMO" : "VNPAY");

/** Order status by age in days (>= 2): old orders are delivered or cancelled, young ones are still on their way. */
function pickStatus(age, roll) {
    const table = age < 3.2
        ? [["SHIPPED", 0.45], ["PROCESSING", 0.25], ["PENDING", 0.15], ["CANCELLED", 0.15]]
        : age < 7
            ? [["DELIVERED", 0.72], ["SHIPPED", 0.12], ["CANCELLED", 0.12], ["PROCESSING", 0.04]]
            : age < 10
                ? [["DELIVERED", 0.86], ["CANCELLED", 0.12], ["SHIPPED", 0.02]]
                : [["DELIVERED", 0.9], ["CANCELLED", 0.1]];
    let cumulative = 0;
    for (const [status, share] of table) {
        cumulative += share;
        if (roll < cumulative) return status;
    }
    return table[table.length - 1][0];
}

function pickPaymentStatus(status, method, roll) {
    if (status === "DELIVERED") return "PAID";
    const online = method !== "COD";
    if (status === "CANCELLED") return online && roll < 0.65 ? "REFUNDED" : "UNPAID";
    if (status === "PENDING") return online && roll < 0.5 ? "PAID" : "UNPAID";
    return online ? "PAID" : "UNPAID";
}

function settledAt(createdAt, status, paymentStatus, roll, reference) {
    let at;
    if (status === "DELIVERED") at = createdAt + 2 * DAY + Math.floor(roll * 24) * HOUR;
    else if (status === "SHIPPED") at = createdAt + DAY + Math.floor(roll * 6) * HOUR;
    else if (status === "PROCESSING") at = createdAt + 2 * HOUR;
    else if (status === "CANCELLED") at = createdAt + 30 * 60 * 1000 + Math.floor(roll * 330) * 60 * 1000;
    else at = createdAt + (paymentStatus === "PAID" ? 30 * 60 * 1000 : 0);
    return Math.min(reference, at);
}

const eligibleCustomers = (customers, createdAt) => customers.filter((customer) => customer.createdAt <= createdAt - 30 * 60 * 1000);

/** Orders from the first day of the history up to 48 hours before `reference`, oldest first. */
function buildHistorySpecs(products, customers, reference) {
    const productWeights = buildProductWeights(products);
    const cutoff = reference - RECENT_WINDOW;
    const specs = [];
    for (let dayStart = HISTORY_START, dayIndex = 0; dayStart < cutoff; dayStart += DAY, dayIndex += 1) {
        const random = createRandom((PRNG_SEED ^ Math.imul(dayIndex + 1, 0x9e3779b1)) >>> 0);
        const local = new Date(dayStart + LOCAL_OFFSET);
        const count = dailyOrderCount(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), random);
        const times = Array.from({ length: count }, () => dayStart + pickOrderTime(random)).sort((left, right) => left - right);
        for (const createdAt of times) {
            // Every draw happens whether or not the order falls inside the window, so a day never depends on `now`.
            const pool = eligibleCustomers(customers, createdAt);
            const customerIndex = pool[pickWeighted(pool.map((customer) => customer.weight), random)].index;
            const productIndexes = pickBasket(products, productWeights[local.getUTCMonth()], random);
            const items = buildItems(products, productIndexes, random);
            const method = pickMethod(random.next());
            const age = (reference - createdAt) / DAY;
            const orderStatus = pickStatus(age, random.next());
            const paymentStatus = pickPaymentStatus(orderStatus, method, random.next());
            const timing = random.next();
            const noteRoll = random.next();
            const note = random.pick(CUSTOMER_NOTES);
            const pointsRoll = random.next();
            const pointsShare = random.next();
            const idSuffix = Math.floor(random.next() * 36 ** 5).toString(36).toUpperCase().padStart(5, "0");
            if (createdAt > cutoff) continue;
            specs.push({
                customerIndex, items, createdAt, method, orderStatus, paymentStatus, voucherCodes: [],
                updatedAt: settledAt(createdAt, orderStatus, paymentStatus, timing, reference),
                note: noteRoll < 0.25 ? note : null,
                pointsRoll, pointsShare, idSuffix
            });
        }
    }
    return specs;
}

/** The RECENT_ORDERS group: the last 48 hours, one order per entry, never redeeming points. */
function buildRecentSpecs(products, customers, reference) {
    const random = createRandom(PRNG_SEED ^ 0x7ec3);
    const everyProduct = products.map((_, index) => index);
    return RECENT_ORDERS.map((recent) => {
        const createdAt = reference - recent.hoursAgo * HOUR;
        const productIndexes = random.shuffle(everyProduct).slice(0, 1 + random.int(2));
        const pool = eligibleCustomers(customers, createdAt);
        const customerIndex = pool[random.int(pool.length)].index;
        const items = buildItems(products, productIndexes, random);
        const cancelled = recent.orderStatus === "CANCELLED";
        const settled = recent.paymentStatus === "PAID" || cancelled || recent.orderStatus !== "PENDING";
        const note = random.next() < 0.25 ? random.pick(CUSTOMER_NOTES) : null;
        const idSuffix = Math.floor(random.next() * 36 ** 5).toString(36).toUpperCase().padStart(5, "0");
        return {
            customerIndex, items, createdAt, method: recent.method, orderStatus: recent.orderStatus,
            paymentStatus: recent.paymentStatus, voucherCodes: recent.vouchers,
            updatedAt: Math.min(reference, createdAt + (settled ? 30 * 60 * 1000 : 0)),
            note, pointsRoll: 1, pointsShare: 0, idSuffix
        };
    });
}

/** Applies VOUCHER_PLAN to the historical specs; usage limits are read from the vouchers themselves. */
function assignVouchers(specs, vouchers, reference) {
    const byCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    const used = new Map(vouchers.map((voucher) => [voucher.code, 0]));
    const available = (spec, event) => spec.voucherCodes.length === 0
        && spec.orderStatus === (event.cancelled ? "CANCELLED" : "DELIVERED")
        && event.codes.every((code) => spec.createdAt >= Date.parse(byCode.get(code).startsAt));
    for (const event of VOUCHER_PLAN) {
        if (event.codes.some((code) => used.get(code) >= byCode.get(code).quantity)) continue;
        const target = event.daysAgo === undefined
            ? Math.min(specs.length - 1, Math.floor(event.at * specs.length))
            : specs.findIndex((spec) => spec.createdAt >= reference - event.daysAgo * DAY);
        if (target < 0) continue;
        let found = -1;
        for (let step = 0; step < specs.length && found < 0; step += 1) {
            if (target + step < specs.length && available(specs[target + step], event)) found = target + step;
            else if (target - step >= 0 && available(specs[target - step], event)) found = target - step;
        }
        if (found < 0) continue;
        specs[found].voucherCodes = [...event.codes];
        for (const code of event.codes) used.set(code, used.get(code) + 1);
    }
}

/**
 * Loyalty rule (GLOSSARY "Points earned"): a cash-on-delivery or bank-transfer order credits its points on delivery, an
 * online (MoMo/VNPay) order when its payment succeeded; a cancelled order credits nothing. Seeded online orders marked
 * PAID succeeded, and every DELIVERED seed order is PAID.
 */
const isPointsCredited = (spec) => {
    if (spec.orderStatus === "CANCELLED" || spec.paymentStatus !== "PAID") return false;
    return spec.orderStatus === "DELIVERED" || spec.method === "MOMO" || spec.method === "VNPAY";
};

/** The statuses an order went through, oldest first, ending on its current status at `updatedAt`. */
function buildStatusHistory(spec, updatedAt) {
    const placed = spec.createdAt;
    const history = [{ status: "PENDING", at: iso(placed) }];
    if (spec.orderStatus === "PENDING") return history;
    if (spec.orderStatus === "DELIVERED") {
        history.push({ status: "PROCESSING", at: iso(placed + 2 * HOUR) }, { status: "SHIPPED", at: iso(placed + DAY) });
    } else if (spec.orderStatus === "SHIPPED") {
        history.push({ status: "PROCESSING", at: iso(placed + 10 * 60 * 1000) });
    }
    history.push({ status: spec.orderStatus, at: iso(updatedAt) });
    return history;
}

/** A balance is what its credited orders earned minus what its orders redeemed (a cancelled order gave its points back). */
function creditLoyalty(users, orders) {
    const balances = new Map(users.map((user) => [user.id, 0]));
    for (const order of orders) {
        if (order.pointsCreditedAt !== null) balances.set(order.userId, balances.get(order.userId) + order.pointsEarned);
        if (order.pointsReleasedAt === null) balances.set(order.userId, balances.get(order.userId) - order.pointsRedeemed);
    }
    for (const user of users) user.loyaltyPoints = balances.get(user.id);
}

/**
 * Turns the specs (oldest first) into order records: voucher discounts, redeemed and earned points. Points are redeemed
 * only out of the balance the customer really had at that moment (credits dated up to the order, minus earlier redemptions,
 * plus points given back by cancelled orders), so no balance ever goes negative.
 */
function finalizeOrders(specs, users, vouchers) {
    const voucherByCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    const movements = new Map(users.map((user) => [user.id, []]));
    const balanceAt = (userId, instant) => movements.get(userId).reduce((sum, move) => (move.at <= instant ? sum + move.points : sum), 0);

    return specs.map((spec) => {
        const customer = CUSTOMER_ROWS[spec.customerIndex];
        const userId = users[spec.customerIndex].id;
        const subtotal = spec.items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
        const chosen = spec.voucherCodes.map((code) => voucherByCode.get(code));
        const amounts = calculateSeedDiscounts(subtotal, SHIPPING_FEE, chosen.map((voucher) => ({
            type: voucher.type,
            percent: voucher.percent,
            maxDiscount: voucher.maxDiscount === null ? null : Number(voucher.maxDiscount)
        })));
        const discount = amounts.reduce((sum, amount) => sum + amount, 0);
        const payable = subtotal + SHIPPING_FEE - discount;
        const cancelled = spec.orderStatus === "CANCELLED";

        let pointsRedeemed = 0;
        let pointsDiscount = 0;
        if (spec.pointsRoll < POINTS_USE_RATE) {
            const balance = balanceAt(userId, spec.createdAt);
            const affordable = Math.min(balance, Math.floor((payable * POINTS_MAX_SHARE) / POINT_VALUE));
            if (affordable >= 1) {
                const redeemed = redeemPoints({ payable, balance, requested: Math.max(1, Math.floor(affordable * (0.4 + 0.6 * spec.pointsShare))) });
                pointsRedeemed = redeemed.used;
                pointsDiscount = redeemed.discount;
            }
        }
        const total = payable - pointsDiscount;
        const credited = isPointsCredited(spec);
        const pointsEarned = earnedPoints(total);
        if (pointsRedeemed > 0) {
            movements.get(userId).push({ at: spec.createdAt, points: -pointsRedeemed });
            if (cancelled) movements.get(userId).push({ at: spec.updatedAt, points: pointsRedeemed });
        }
        if (credited) movements.get(userId).push({ at: spec.updatedAt, points: pointsEarned });

        return {
            id: `ORD-${spec.createdAt.toString(36).toUpperCase()}-${spec.idSuffix}`,
            userId,
            subtotal: money(subtotal),
            shippingFee: money(SHIPPING_FEE),
            discount: money(discount),
            totalPrice: money(total),
            pointsRedeemed,
            pointsDiscount: money(pointsDiscount),
            pointsReleasedAt: pointsRedeemed > 0 && cancelled ? iso(spec.updatedAt) : null,
            pointsEarned,
            pointsCreditedAt: credited ? iso(spec.updatedAt) : null,
            statusHistory: buildStatusHistory(spec, spec.updatedAt),
            customer: { name: customer[0], phone: customer[3], address: customer[4], note: spec.note },
            paymentMethod: PAYMENT[spec.method],
            orderStatus: spec.orderStatus,
            paymentStatus: spec.paymentStatus,
            createdAt: iso(spec.createdAt),
            updatedAt: iso(spec.updatedAt),
            items: spec.items.map(({ productId, ...item }) => item),
            vouchers: chosen.map((voucher, voucherIndex) => ({
                code: voucher.code,
                type: voucher.type,
                percent: voucher.percent,
                discountAmount: money(amounts[voucherIndex]),
                releasedAt: cancelled ? iso(spec.updatedAt) : null
            }))
        };
    });
}

function applyRedeemedCounts(vouchers, orders) {
    for (const voucher of vouchers) {
        voucher.redeemedCount = orders.reduce((count, order) => count + order.vouchers.filter((used) => used.code === voucher.code && used.releasedAt === null).length, 0);
    }
}

function buildReviews(products, orders, now, random) {
    const skuToProduct = new Map();
    for (const product of products) for (const variant of product.variants) skuToProduct.set(variant.sku, product.id);
    // First delivered order of each (product, customer): reviews come after it.
    const firstDelivered = new Map();
    for (const order of orders) {
        if (order.orderStatus !== "DELIVERED") continue;
        for (const item of order.items) {
            const key = `${skuToProduct.get(item.variantSku)}|${order.userId}`;
            const known = firstDelivered.get(key);
            if (!known || Date.parse(order.updatedAt) < Date.parse(known.updatedAt)) firstDelivered.set(key, order);
        }
    }

    const reviews = [];
    let slot = 0;
    let hiddenAssigned = false;
    const globalUse = new Map();
    for (const product of products) {
        const profile = REVIEW_PROFILES[product.id];
        if (profile === null || profile === undefined) continue;
        const group = COMMENTS.positive[product.deviceType] ? product.deviceType : "general";
        const wired = (group === "keyboard" || group === "mouse") && !product.tags.includes("khong-day");
        const buyers = random.shuffle([...new Set([...firstDelivered.keys()].filter((key) => key.startsWith(`${product.id}|`)).map((key) => key.split("|")[1]))]);
        const count = Math.min(buyers.length, 3 + random.int(6));
        const ratings = random.shuffle(Array.isArray(profile) ? profile : [4]);
        const used = new Set();
        for (let index = 0; index < count; index += 1) {
            slot += 1;
            const commentOnly = profile === "COMMENT_ONLY" || (slot % 17 === 5);
            const ratingOnly = !commentOnly && slot % 7 === 3;
            const rating = commentOnly ? null : ratings[index % ratings.length];
            const tier = rating === null ? (random.next() < 0.8 ? "positive" : "neutral") : rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
            let comment = null;
            if (!ratingOnly) {
                const pool = [...COMMENTS[tier][group], ...COMMENTS[tier].general].filter((text) =>
                    !used.has(text) && (!wired || !/pin|Bluetooth|không dây|ghép nối|chuyển giữa máy tính/i.test(text)));
                // Prefer the phrases used least across the whole seed so the comments stay varied.
                const least = Math.min(...pool.map((text) => globalUse.get(text) || 0));
                comment = random.pick(pool.filter((text) => (globalUse.get(text) || 0) === least));
                used.add(comment);
                globalUse.set(comment, least + 1);
            }
            const order = firstDelivered.get(`${product.id}|${buyers[index]}`);
            const earliest = Date.parse(order.updatedAt) + HOUR;
            const createdAt = Math.floor(Math.min(now - HOUR, earliest + random.next() * 8 * DAY));
            let isHidden = false;
            if (!hiddenAssigned && product.id === 402 && rating !== null && comment !== null) {
                isHidden = true;
                hiddenAssigned = true;
            }
            reviews.push({ productId: product.id, userId: buyers[index], rating, comment, isHidden, createdAt: iso(createdAt), updatedAt: iso(createdAt) });
        }
    }
    return reviews;
}

/**
 * Builds the customer-side seed data for `products` (the seed catalogue). `now` fixes every relative timestamp.
 * Returns { users, vouchers, orders, reviews }.
 */
function buildSeedFixtures(products, now = new Date()) {
    const reference = Math.floor(now.getTime() / 1000) * 1000;
    const users = buildUsers(reference);
    const vouchers = buildVouchers(reference);
    const customers = buildCustomerPool(users);
    const history = buildHistorySpecs(products, customers, reference);
    assignVouchers(history, vouchers, reference);
    const specs = [...history, ...buildRecentSpecs(products, customers, reference)];
    const orders = finalizeOrders(specs, users, vouchers);
    applyRedeemedCounts(vouchers, orders);
    creditLoyalty(users, orders);
    const reviews = buildReviews(products, orders, reference, createRandom(PRNG_SEED));
    return { users, vouchers, orders, reviews };
}

const COMMENT_POOL_SIZE = Object.values(COMMENTS).reduce((total, groups) => total + Object.values(groups).reduce((sum, list) => sum + list.length, 0), 0);

module.exports = { COMMENT_POOL_SIZE, SHIPPING_FEE, buildSeedFixtures, calculateSeedDiscounts, createRandom };
