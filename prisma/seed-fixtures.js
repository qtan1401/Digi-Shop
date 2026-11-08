/*
 * Deterministic demo customers, vouchers, orders and product reviews for the local seed.
 *
 * Everything is derived from a fixed PRNG seed and a fixed list of customers, so ids, codes, amounts,
 * comments and the shape of the data are identical on every run. Only timestamps move: they are expressed
 * relative to `now` (the moment the seed module is loaded). The seed never compares timestamps when it
 * decides whether a record is already present, so re-running it later inserts nothing new.
 */

const { NO_EXPIRY_DATE } = require("../src/services/voucher-calculator");
const { earnedPoints } = require("../src/services/loyalty-calculator");

const SHIPPING_FEE = 100000;
const VOUCHER_MAX_DISCOUNT = 500000;
const ORDER_MAX_DISCOUNT = 1000000;
const MIN_TOTAL = 1000;
const PRNG_SEED = 0x5eed2026;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

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

// A second saved address for a few customers, so the address book and the checkout selector have more than one entry.
// Keyed by customer position; the customer's own contact details (CUSTOMERS) are their default address.
const EXTRA_ADDRESSES = new Map([
    [0, ["Trần Thị Mai", "0987654301", "27 Kim Mã, Ba Đình, Hà Nội"]],
    [1, ["Nguyễn Văn Long", "0987654302", "310 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh"]],
    [4, ["Phạm Thu Hà", "0987654305", "15 Nguyễn Văn Cừ, Ninh Kiều, Cần Thơ"]]
]);

const CUSTOMER_NOTES = [
    "Giao giờ hành chính giúp mình.",
    "Gọi trước khi giao 15 phút.",
    "Giao cho bảo vệ nếu mình không có nhà.",
    "Xuất hóa đơn công ty giúp mình.",
    "Đóng gói kỹ giúp mình, cảm ơn shop."
];

// Codes are 5 letters/digits, usage limit is at most 10, and nothing expires (course spec).
const VOUCHER_DEFINITIONS = [
    { code: "NEW10", description: "Giảm 10%, tối đa 200.000₫", type: "PERCENT", percent: 10, maxDiscount: 200000, from: -120, quantity: 10, enabled: true, listed: true },
    { code: "SALE5", description: "Giảm 5%, tối đa 500.000₫", type: "PERCENT", percent: 5, maxDiscount: 500000, from: -120, quantity: 10, enabled: true, listed: true },
    { code: "FSHIP", description: "Miễn phí vận chuyển cho mọi đơn hàng", type: "FREE_SHIPPING", percent: null, maxDiscount: null, from: -120, quantity: 10, enabled: true, listed: true },
    { code: "OFF15", description: "Giảm 15%, tối đa 300.000₫", type: "PERCENT", percent: 15, maxDiscount: 300000, from: -30, quantity: 10, enabled: true, listed: true },
    { code: "OFF20", description: "Giảm 20%, tối đa 400.000₫", type: "PERCENT", percent: 20, maxDiscount: 400000, from: -120, quantity: 10, enabled: true, listed: true },
    { code: "PAUSE", description: "Giảm 8%, tối đa 150.000₫ — tạm ngưng", type: "PERCENT", percent: 8, maxDiscount: 150000, from: -60, quantity: 10, enabled: false, listed: true },
    { code: "FULL3", description: "Giảm 12%, tối đa 250.000₫ — đã hết lượt", type: "PERCENT", percent: 12, maxDiscount: 250000, from: -120, quantity: 3, enabled: true, listed: true },
    { code: "VIP25", description: "Giảm 25%, tối đa 500.000₫ — mã riêng cho khách VIP", type: "PERCENT", percent: 25, maxDiscount: 500000, from: -120, quantity: 10, enabled: true, listed: false }
];

// Voucher use by position among delivered orders (oldest first).
const DELIVERED_VOUCHER_PLAN = new Map([
    [3, ["NEW10"]],
    [8, ["NEW10", "FSHIP"]],
    [12, ["OFF20"]],
    [17, ["FULL3"]],
    [21, ["VIP25", "NEW10", "FSHIP"]],
    [25, ["FULL3"]],
    [29, ["SALE5"]],
    [33, ["FULL3"]],
    [36, ["OFF15"]]
]);

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
    101: [5, 5, 4, 5, 5, 5, 4, 5],
    102: [4, 3, 4, 3, 5, 4, 3, 4],
    103: [5, 5, 5, 4, 5, 5, 5, 4],
    104: [4, 5, 4, 4, 5, 3, 4, 5],
    105: null,
    201: [4, 5, 4, 5, 4, 4, 5, 3],
    202: [5, 5, 4, 5, 5, 5, 5, 4],
    203: [4, 3, 4, 4, 3, 4, 5, 3],
    204: "COMMENT_ONLY",
    205: [4, 4, 5, 3, 4, 5, 4, 4],
    301: [5, 5, 5, 4, 5, 5, 4, 5],
    302: [4, 1, 5, 2, 4, 3, 4, 5],
    303: [3, 4, 4, 3, 4, 3, 5, 4],
    304: [4, 5, 4, 4, 5, 4, 3, 5],
    305: [3, 4, 3, 2, 4, 3, 4, 3]
};

const COMMENTS = {
    positive: {
        phone: [
            "Pin dùng thoải mái cả ngày, sạc nhanh, mình rất hài lòng.",
            "Camera chụp ảnh rất nét, nhất là ban đêm, chụp xong gần như không cần chỉnh.",
            "Màn hình sáng đẹp, màu sắc chuẩn, xem video rất đã mắt.",
            "Hiệu năng mượt, chơi game nặng không giật lag, máy cũng không nóng.",
            "Thiết kế sang, cầm vừa tay, hoàn thiện rất chắc chắn.",
            "Quay video ổn định, chống rung tốt, đi du lịch dùng rất tiện.",
            "Dùng được một thời gian rồi, máy vẫn nhanh và mượt như ngày đầu."
        ],
        tablet: [
            "Màn hình lớn, hiển thị đẹp, xem phim và vẽ đều tuyệt vời.",
            "Pin trâu, mình dùng học online cả ngày vẫn còn dư.",
            "Cầm bút vẽ rất mượt, không có độ trễ, phù hợp ghi chú và thiết kế.",
            "Loa nghe to và rõ, xem phim giải trí rất đã.",
            "Máy mỏng nhẹ, mang đi làm đi học đều tiện, hiệu năng dư dùng.",
            "Hiệu năng mạnh, mở nhiều ứng dụng cùng lúc vẫn mượt."
        ],
        laptop: [
            "Hiệu năng mạnh, làm việc đồ họa và code đều mượt, quạt chạy êm.",
            "Pin dùng được cả ngày làm việc văn phòng, rất đáng tiền.",
            "Màn hình đẹp, độ sáng cao, làm việc ngoài trời vẫn nhìn rõ.",
            "Bàn phím gõ êm, touchpad nhạy, dùng cả ngày không mỏi tay.",
            "Máy nhẹ, thiết kế gọn, mang đi công tác rất thuận tiện.",
            "Tản nhiệt tốt, chơi game vài tiếng máy vẫn mát và ổn định.",
            "Khởi động nhanh, mở ứng dụng nặng gần như tức thì."
        ],
        general: [
            "Giao hàng nhanh, đóng gói cẩn thận, hộp còn nguyên seal.",
            "Giá tốt hơn nhiều nơi khác, nhân viên tư vấn nhiệt tình.",
            "Đóng gói chắc chắn, có chống sốc kỹ, nhận hàng không trầy xước.",
            "Shop giao đúng hẹn, sản phẩm chính hãng, đầy đủ phụ kiện.",
            "Sản phẩm đúng như mô tả, dùng rất ưng, sẽ ủng hộ shop tiếp.",
            "Bảo hành rõ ràng, shop hỗ trợ nhanh khi mình cần hỏi.",
            "Mua với giá hợp lý, chất lượng vượt mong đợi.",
            "Giao hàng trong ngày, kiểm tra máy kỹ trước khi nhận, rất yên tâm."
        ]
    },
    neutral: {
        phone: [
            "Máy dùng ổn, nhưng pin chỉ đủ một ngày dùng nhiều, hơi tiếc.",
            "Camera tốt trong điều kiện đủ sáng, ban đêm vẫn còn nhiễu nhẹ.",
            "Hiệu năng ổn, tuy nhiên máy hơi nóng khi chơi game lâu."
        ],
        tablet: [
            "Màn hình đẹp nhưng pin xuống hơi nhanh khi xem video độ sáng cao.",
            "Máy dùng tạm ổn, giá hơi cao so với cấu hình.",
            "Hiệu năng đủ dùng học tập, nhưng chơi game nặng sẽ hơi chậm."
        ],
        laptop: [
            "Hiệu năng ổn, nhưng quạt hơi ồn khi chạy tác vụ nặng.",
            "Màn hình tạm được, pin dùng khoảng nửa ngày văn phòng.",
            "Máy chạy tốt, nhưng thân máy hơi nóng khi sạc và làm việc lâu."
        ],
        general: [
            "Sản phẩm tốt, nhưng giao hàng chậm hơn dự kiến một ngày.",
            "Đóng gói ổn, hộp hơi móp góc nhưng máy không sao.",
            "Giá chấp nhận được, mong shop có thêm nhiều ưu đãi hơn.",
            "Dùng ổn so với tầm giá, chưa có điểm nào quá nổi bật."
        ]
    },
    negative: {
        phone: [
            "Pin tụt khá nhanh sau vài tuần dùng, mình hơi thất vọng.",
            "Camera chụp trong nhà thiếu sáng bị nhòe, không như quảng cáo.",
            "Máy hay nóng khi dùng mạng lâu, mong hãng cải thiện."
        ],
        tablet: [
            "Màn hình bị hở sáng nhẹ ở góc, mình đã liên hệ shop để kiểm tra.",
            "Pin xuống nhanh hơn mình nghĩ, dùng chưa tới nửa ngày."
        ],
        laptop: [
            "Quạt ồn và máy nóng khi dùng lâu, hiệu năng không như kỳ vọng.",
            "Pin không được lâu, chỉ khoảng 3 tiếng dùng thực tế.",
            "Bàn lề hơi lỏng sau một thời gian, mong shop hỗ trợ bảo hành."
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

const userIdFor = (index) => `5eed0000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`;
const addressIdFor = (index, position) => `5eed0000-0000-4000-9000-${String(index + 1).padStart(6, "0")}${String(position).padStart(6, "0")}`;

function buildUsers(now) {
    return CUSTOMERS.map(([name, email, username, phone, address], index) => {
        const createdAt = now - 100 * DAY - index * 3 * HOUR;
        const extra = EXTRA_ADDRESSES.get(index);
        return {
            id: userIdFor(index),
            email,
            username,
            fullName: name,
            role: "user",
            status: "ACTIVE",
            emailVerifiedAt: iso(createdAt + 5 * 60 * 1000),
            // Balance = points of the orders credited so far; set by creditLoyalty once the orders exist.
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

function buildVouchers(now) {
    return VOUCHER_DEFINITIONS.map((definition) => ({
        code: definition.code,
        description: definition.description,
        type: definition.type,
        percent: definition.percent,
        maxDiscount: definition.maxDiscount === null ? null : money(definition.maxDiscount),
        startsAt: iso(now + definition.from * DAY),
        endsAt: NO_EXPIRY_DATE.toISOString(),
        quantity: definition.quantity,
        redeemedCount: 0,
        isEnabled: definition.enabled,
        isListed: definition.listed,
        createdAt: iso(now + definition.from * DAY),
        updatedAt: iso(now + definition.from * DAY)
    }));
}

function buildOrderSkeletons(products, random) {
    const skeletons = [];
    const byCustomer = CUSTOMERS.map(() => []);
    // Every product gets four distinct buyers.
    products.forEach((_, productIndex) => {
        for (let offset = 0; offset < 4; offset += 1) byCustomer[(3 * productIndex + offset) % CUSTOMERS.length].push(productIndex);
    });
    const chunkSizes = [3, 2, 3, 2, 3, 1];
    byCustomer.forEach((productIndexes, customerIndex) => {
        const shuffled = random.shuffle(productIndexes);
        let cursor = 0;
        let chunk = customerIndex % chunkSizes.length;
        while (cursor < shuffled.length) {
            const size = chunkSizes[chunk % chunkSizes.length];
            skeletons.push({ customerIndex, productIndexes: shuffled.slice(cursor, cursor + size) });
            cursor += size;
            chunk += 1;
        }
    });
    // Repeat customers: top up to forty delivered orders.
    while (skeletons.length < 40) {
        const productIndexes = random.shuffle(products.map((_, index) => index)).slice(0, 1 + random.int(2));
        skeletons.push({ customerIndex: random.int(CUSTOMERS.length), productIndexes });
    }
    return random.shuffle(skeletons);
}

function buildItems(products, productIndexes, random) {
    return productIndexes.map((productIndex) => {
        const variant = random.pick(products[productIndex].variants);
        const quantity = Number(variant.price) < 10000000 && random.next() < 0.3 ? 2 : 1;
        return { variantSku: variant.sku, unitPrice: money(Number(variant.price)), quantity, lineTotal: money(Number(variant.price) * quantity), productId: products[productIndex].id };
    });
}

function orderIdFor(index, random) {
    const stamp = (1730000000000 + index * 97531000).toString(36).toUpperCase();
    const suffix = Math.floor(random.next() * 36 ** 5).toString(36).toUpperCase().padStart(5, "0");
    return `ORD-${stamp}-${suffix}`;
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

function creditLoyalty(users, orders) {
    const balances = new Map(users.map((user) => [user.id, 0]));
    for (const order of orders) {
        if (order.pointsCreditedAt !== null) balances.set(order.userId, balances.get(order.userId) + order.pointsEarned);
    }
    for (const user of users) user.loyaltyPoints = balances.get(user.id);
}

function buildOrders(products, users, vouchers, now, random) {
    const voucherByCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    const delivered = buildOrderSkeletons(products, random);
    const total = delivered.length;
    const days = delivered.map((_, index) => {
        const base = 90 - (82.5 * index) / (total - 1);
        return Math.min(90, Math.max(7.25, base + (random.next() - 0.5) * 0.6));
    }).sort((left, right) => right - left);

    const specs = delivered.map((skeleton, index) => ({
        customerIndex: skeleton.customerIndex,
        items: buildItems(products, skeleton.productIndexes, random),
        createdAt: Math.floor(now - days[index] * DAY),
        method: ["COD", "MOMO", "COD", "VNPAY"][index % 4],
        orderStatus: "DELIVERED",
        paymentStatus: "PAID",
        voucherCodes: DELIVERED_VOUCHER_PLAN.get(index) || []
    }));
    for (const recent of RECENT_ORDERS) {
        const productIndexes = random.shuffle(products.map((_, index) => index)).slice(0, 1 + random.int(2));
        specs.push({
            customerIndex: random.int(CUSTOMERS.length),
            items: buildItems(products, productIndexes, random),
            createdAt: now - recent.hoursAgo * HOUR,
            method: recent.method,
            orderStatus: recent.orderStatus,
            paymentStatus: recent.paymentStatus,
            voucherCodes: recent.vouchers
        });
    }

    return specs.map((spec, index) => {
        const customer = CUSTOMERS[spec.customerIndex];
        const subtotal = spec.items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
        const chosen = spec.voucherCodes.map((code) => voucherByCode.get(code));
        const amounts = calculateSeedDiscounts(subtotal, SHIPPING_FEE, chosen.map((voucher) => ({
            type: voucher.type,
            percent: voucher.percent,
            maxDiscount: voucher.maxDiscount === null ? null : Number(voucher.maxDiscount)
        })));
        const discount = amounts.reduce((sum, amount) => sum + amount, 0);
        const delivered = spec.orderStatus === "DELIVERED";
        const cancelled = spec.orderStatus === "CANCELLED";
        const updatedAt = delivered
            ? spec.createdAt + 2 * DAY + random.int(24) * HOUR
            : Math.min(now, spec.createdAt + (spec.paymentStatus === "PAID" || cancelled || spec.orderStatus !== "PENDING" ? 30 * 60 * 1000 : 0));
        const note = random.next() < 0.25 ? random.pick(CUSTOMER_NOTES) : null;
        const total = subtotal + SHIPPING_FEE - discount;
        const credited = isPointsCredited(spec);
        return {
            id: orderIdFor(index, random),
            userId: users[spec.customerIndex].id,
            subtotal: money(subtotal),
            shippingFee: money(SHIPPING_FEE),
            discount: money(discount),
            totalPrice: money(total),
            pointsEarned: earnedPoints(total),
            pointsCreditedAt: credited ? iso(updatedAt) : null,
            statusHistory: buildStatusHistory(spec, updatedAt),
            customer: { name: customer[0], phone: customer[3], address: customer[4], note },
            paymentMethod: PAYMENT[spec.method],
            orderStatus: spec.orderStatus,
            paymentStatus: spec.paymentStatus,
            createdAt: iso(spec.createdAt),
            updatedAt: iso(updatedAt),
            items: spec.items.map(({ productId, ...item }) => item),
            vouchers: chosen.map((voucher, voucherIndex) => ({
                code: voucher.code,
                type: voucher.type,
                percent: voucher.percent,
                discountAmount: money(amounts[voucherIndex]),
                releasedAt: cancelled ? iso(updatedAt) : null
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
                const pool = [...COMMENTS[tier][group], ...COMMENTS[tier].general].filter((text) => !used.has(text));
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
            if (!hiddenAssigned && product.id === 102 && rating !== null && comment !== null) {
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
    const random = createRandom(PRNG_SEED);
    const users = buildUsers(reference);
    const vouchers = buildVouchers(reference);
    const orders = buildOrders(products, users, vouchers, reference, random).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    applyRedeemedCounts(vouchers, orders);
    creditLoyalty(users, orders);
    const reviews = buildReviews(products, orders, reference, random);
    return { users, vouchers, orders, reviews };
}

const COMMENT_POOL_SIZE = Object.values(COMMENTS).reduce((total, groups) => total + Object.values(groups).reduce((sum, list) => sum + list.length, 0), 0);

module.exports = { COMMENT_POOL_SIZE, SHIPPING_FEE, buildSeedFixtures, calculateSeedDiscounts, createRandom };
