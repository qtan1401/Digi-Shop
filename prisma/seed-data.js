const { buildSeedFixtures } = require("./seed-fixtures");
const { BRANDS, DEVICE_TYPES } = require("../public/js/catalog-taxonomy");

const CREATED_AT = "2026-10-22T00:00:00.000Z";
// Deterministic stock levels; the small values exercise the "Chỉ còn N" badge on the storefront.
const STOCK_CYCLE = [14, 9, 22, 6, 17, 3, 11, 8, 25, 5, 12, 19, 2, 16, 7, 10];

/*
 * A product is described by its copy, its spec sheet and up to two option dimensions:
 *   primary   - the dimension that owns the photos (usually "Màu sắc"); each value carries its image file and, for
 *               colours, a swatch hex. `delta` adds to the price of every variant that uses the value.
 *   secondary - an optional second dimension (storage, switch, size...); each value carries its price.
 * Every combination becomes one variant with its own SKU and stock.
 * The description ends with a "Thông số kỹ thuật" block of `Nhãn: Giá trị` lines (a line without a colon starts a group);
 * the product page renders that block as a table and everything above it as the description.
 */
const buildProduct = ({ id, brand, deviceType, name, slug, intro, specs, skuBase, primary, secondary, image }) => {
    const description = [...intro, "", "Thông số kỹ thuật", ...specs].join("\n");
    const imagePath = (file) => `/uploads/products/${file}`;
    const options = [];
    if (primary) options.push({ name: primary.name, values: primary.values.map(({ value, hex }) => (hex ? { value, colorHex: hex } : { value })) });
    if (secondary) options.push({ name: secondary.name, values: secondary.values.map(({ value }) => ({ value })) });

    const variants = [];
    const primaryValues = primary ? primary.values : [null];
    const secondaryValues = secondary ? secondary.values : [null];
    for (const first of primaryValues) {
        for (const second of secondaryValues) {
            const skuParts = [skuBase, first?.code, second?.code].filter(Boolean);
            const optionValues = {};
            if (first) optionValues[primary.name] = first.value;
            if (second) optionValues[secondary.name] = second.value;
            const stockIndex = (id + variants.length * 3) % STOCK_CYCLE.length;
            variants.push({
                sku: skuParts.join("-"),
                price: (second?.price ?? primary?.basePrice ?? 0) + (first?.delta ?? 0),
                stock: second?.stock ?? first?.stock ?? STOCK_CYCLE[stockIndex],
                image: imagePath(first?.file ?? image),
                isActive: true,
                optionValues
            });
        }
    }
    return {
        id, brand, deviceType, name, slug,
        image: imagePath(primary ? primary.values[0].file : image),
        description, options, variants,
        isDeleted: false, deletedAt: null, createdAt: CREATED_AT, updatedAt: CREATED_AT
    };
};

const COLOR = "Màu sắc";
const products = [
    // ===== Laptop =====
    buildProduct({
        id: 301, brand: "Apple", deviceType: "laptop", name: "MacBook Air M3 13 inch", slug: "macbook-air-m3-13-inch", skuBase: "MBAM3",
        intro: [
            "MacBook Air 13 inch với chip Apple M3 là chiếc laptop mỏng nhẹ dành cho học tập, văn phòng và sáng tạo nội dung hằng ngày.",
            "Thân máy nhôm nguyên khối chỉ dày 11,3 mm, nặng khoảng 1,24 kg, dễ bỏ vào balo và mang theo cả ngày.",
            "Chip M3 với CPU 8 nhân xử lý mượt trình duyệt nhiều tab, Office, lập trình và chỉnh sửa ảnh, video cơ bản.",
            "Màn hình Liquid Retina 13,6 inch sắc nét, hiển thị dải màu P3 rộng và độ sáng 500 nits, dùng thoải mái trong nhà lẫn ngoài trời.",
            "Thiết kế không quạt giúp máy hoàn toàn yên tĩnh, pin dùng đến 18 giờ xem video cho một ngày làm việc dài."
        ],
        specs: [
            "Hiệu năng",
            "Bộ xử lý: Apple M3, CPU 8 nhân, GPU 8 nhân",
            "RAM: 16GB bộ nhớ hợp nhất",
            "Ổ cứng: SSD 256GB hoặc 512GB",
            "Màn hình",
            "Kích thước: 13,6 inch Liquid Retina, 2560 x 1664, 500 nits",
            "Kết nối và pin",
            "Cổng kết nối: 2 x Thunderbolt / USB 4, MagSafe 3, jack tai nghe 3,5 mm",
            "Thời lượng pin: đến 18 giờ xem video",
            "Trọng lượng: 1,24 kg"
        ],
        primary: { name: COLOR, values: [{ value: "Space Gray", code: "SGR", hex: "#5F5F5F", file: "301-gray.png" }] },
        secondary: { name: "Bộ nhớ", values: [
            { value: "16GB/256GB", code: "16256", price: 23990000, stock: 9 },
            { value: "16GB/512GB", code: "16512", price: 27990000, stock: 6 }
        ] }
    }),
    buildProduct({
        id: 302, brand: "Apple", deviceType: "laptop", name: "MacBook Pro 14 M4", slug: "macbook-pro-14-m4", skuBase: "MBP14",
        intro: [
            "MacBook Pro 14 inch với chip Apple M4 dành cho người làm đồ họa, dựng phim, lập trình và các tác vụ chuyên nghiệp nặng.",
            "Màn hình Liquid Retina XDR 14,2 inch cho độ tương phản cực cao, tần số quét thích ứng ProMotion đến 120Hz.",
            "Chip M4 mạnh hơn rõ rệt thế hệ trước, biên dịch mã, render 3D và xuất video 4K nhanh mà máy vẫn mát và êm.",
            "Đủ cổng cho công việc: 3 cổng Thunderbolt 4, HDMI, khe thẻ SDXC và MagSafe 3 sạc nhanh.",
            "Pin dùng đến 24 giờ xem video, loa 6 loa và bộ ba micro chất lượng studio phục vụ họp trực tuyến và thu âm."
        ],
        specs: [
            "Hiệu năng",
            "Bộ xử lý: Apple M4, CPU 10 nhân, GPU 10 nhân",
            "RAM: 16GB hoặc 24GB bộ nhớ hợp nhất",
            "Ổ cứng: SSD 512GB hoặc 1TB",
            "Màn hình",
            "Kích thước: 14,2 inch Liquid Retina XDR, 3024 x 1964, ProMotion 120Hz",
            "Kết nối và pin",
            "Cổng kết nối: 3 x Thunderbolt 4, HDMI, khe thẻ SDXC, MagSafe 3, jack tai nghe 3,5 mm",
            "Thời lượng pin: đến 24 giờ xem video",
            "Trọng lượng: 1,55 kg"
        ],
        primary: { name: COLOR, values: [{ value: "Space Black", code: "SBK", hex: "#1B1B1C", file: "302-black.png" }] },
        secondary: { name: "Bộ nhớ", values: [
            { value: "16GB/512GB", code: "16512", price: 38590000, stock: 7 },
            { value: "24GB/1TB", code: "241024", price: 46990000, stock: 4 }
        ] }
    }),
    buildProduct({
        id: 303, brand: "Apple", deviceType: "laptop", name: "MacBook Air M2 13 inch", slug: "macbook-air-m2-13-inch", skuBase: "MBAM2",
        intro: [
            "MacBook Air 13 inch với chip Apple M2 là lựa chọn gọn nhẹ, giá dễ tiếp cận cho sinh viên và dân văn phòng.",
            "Thiết kế phẳng mới, viền màn hình mỏng và bàn phím Magic Keyboard gõ êm, bố cục đầy đủ hàng phím chức năng.",
            "Chip M2 xử lý tốt học trực tuyến, làm việc với tài liệu, duyệt web và các ứng dụng sáng tạo nhẹ nhàng.",
            "Màn hình Liquid Retina 13,6 inch sáng 500 nits, sạc MagSafe giữ trọn hai cổng Thunderbolt cho phụ kiện.",
            "Camera FaceTime HD 1080p và hệ thống bốn loa hỗ trợ âm thanh không gian cho các cuộc gọi video rõ nét."
        ],
        specs: [
            "Hiệu năng",
            "Bộ xử lý: Apple M2, CPU 8 nhân, GPU 8 nhân",
            "RAM: 8GB hoặc 16GB bộ nhớ hợp nhất",
            "Ổ cứng: SSD 256GB hoặc 512GB",
            "Màn hình",
            "Kích thước: 13,6 inch Liquid Retina, 2560 x 1664, 500 nits",
            "Kết nối và pin",
            "Cổng kết nối: 2 x Thunderbolt / USB 4, MagSafe 3, jack tai nghe 3,5 mm",
            "Thời lượng pin: đến 18 giờ xem video",
            "Trọng lượng: 1,24 kg"
        ],
        primary: { name: COLOR, values: [{ value: "Midnight", code: "MID", hex: "#1B1B20", file: "303-midnight.jpg" }] },
        secondary: { name: "Bộ nhớ", values: [
            { value: "8GB/256GB", code: "8256", price: 18990000, stock: 12 },
            { value: "16GB/512GB", code: "16512", price: 24990000, stock: 6 }
        ] }
    }),
    buildProduct({
        id: 304, brand: "MSI", deviceType: "laptop", name: "MSI Katana 15 B13V", slug: "msi-katana-15-b13v", skuBase: "KATANA15",
        intro: [
            "Laptop gaming MSI Katana 15 B13V kết hợp vi xử lý Intel Core i7 thế hệ 13 với card đồ họa NVIDIA GeForce RTX 4050.",
            "Màn hình 15,6 inch Full HD tần số quét 144Hz cho hình ảnh mượt khi chơi game esport và xem phim.",
            "Hệ thống tản nhiệt Cooler Boost 5 với nhiều ống đồng giữ máy ổn định khi chơi game nhiều giờ liền.",
            "Bàn phím có đèn nền, hành trình phím tốt, phù hợp cả chơi game lẫn làm việc.",
            "Hai cấu hình RAM và SSD để chọn theo nhu cầu: 16GB/512GB cho phổ thông hoặc 32GB/1TB cho người dùng nặng."
        ],
        specs: [
            "Hiệu năng",
            "Bộ xử lý: Intel Core i7-13620H",
            "Card đồ họa: NVIDIA GeForce RTX 4050 6GB",
            "RAM: 16GB hoặc 32GB DDR5",
            "Ổ cứng: SSD NVMe 512GB hoặc 1TB",
            "Màn hình",
            "Kích thước: 15,6 inch Full HD (1920 x 1080), 144Hz"
        ],
        primary: { name: COLOR, values: [{ value: "Đen", code: "DEN", hex: "#1A1A1A", file: "304-black-converted.png" }] },
        secondary: { name: "Bộ nhớ", values: [
            { value: "16GB/512GB", code: "16512", price: 24490000, stock: 8 },
            { value: "32GB/1TB", code: "321024", price: 29990000, stock: 5 }
        ] }
    }),
    buildProduct({
        id: 305, brand: "MSI", deviceType: "laptop", name: "MSI Modern 14 H D13M", slug: "msi-modern-14-h-d13m", skuBase: "MODERN14",
        intro: [
            "Laptop văn phòng MSI Modern 14 H D13M dùng vi xử lý Intel Core i7-13700H hiệu năng cao trong thân máy 14 inch gọn gàng.",
            "Màn hình 14 inch Full HD+ tỷ lệ 16:10 hiển thị nhiều nội dung hơn, thuận tiện cho bảng tính và soạn thảo.",
            "Vỏ máy thiết kế tối giản, mỏng nhẹ, phù hợp đem đến công ty, quán cà phê hay giảng đường.",
            "Bàn phím gõ êm, touchpad rộng và bản lề chắc chắn cho trải nghiệm làm việc cả ngày.",
            "Hai tùy chọn RAM 8GB hoặc 16GB cùng SSD 512GB để cân đối giữa ngân sách và nhu cầu đa nhiệm."
        ],
        specs: [
            "Hiệu năng",
            "Bộ xử lý: Intel Core i7-13700H",
            "RAM: 8GB hoặc 16GB",
            "Ổ cứng: SSD NVMe 512GB",
            "Màn hình",
            "Kích thước: 14 inch Full HD+ (1920 x 1200), tỷ lệ 16:10"
        ],
        primary: { name: COLOR, values: [{ value: "Đen", code: "DEN", hex: "#1A1A1A", file: "305-black.png" }] },
        secondary: { name: "Bộ nhớ", values: [
            { value: "8GB/512GB", code: "8512", price: 14990000, stock: 10 },
            { value: "16GB/512GB", code: "16512", price: 15990000, stock: 7 }
        ] }
    }),

    // ===== Bàn phím =====
    buildProduct({
        id: 401, brand: "Apple", deviceType: "keyboard", name: "Apple Magic Keyboard Touch ID và Numeric Keypad", slug: "apple-magic-keyboard-touch-id-numeric-keypad", skuBase: "MKB-TID",
        intro: [
            "Magic Keyboard có Touch ID và cụm phím số là bàn phím không dây đầy đủ phím dành cho người dùng Mac.",
            "Touch ID cho phép mở khóa máy, xác thực mật khẩu và thanh toán Apple Pay chỉ bằng một chạm vân tay.",
            "Hành trình phím thấp, gõ êm và chính xác, cụm phím số tiện cho nhập liệu bảng tính và kế toán.",
            "Kết nối Bluetooth ghép nối tự động với Mac, pin sạc lại qua cổng USB-C và kèm sẵn cáp trong hộp.",
            "Thân nhôm mỏng với hai phiên bản màu phím trắng và phím đen, đồng bộ với Mac và Magic Mouse."
        ],
        specs: [
            "Kiểu bàn phím: Không dây, đầy đủ phím số (Numeric Keypad)",
            "Bảo mật: Touch ID (dùng với Mac chip Apple silicon)",
            "Kết nối: Bluetooth, cáp USB-C đi kèm",
            "Pin: Sạc lại qua cổng USB-C",
            "Tương thích: Mac và các thiết bị Apple khác qua Bluetooth"
        ],
        primary: { name: COLOR, values: [
            { value: "Phím trắng", code: "TRG", hex: "#F2F2F4", file: "401-trang.png" },
            { value: "Phím đen", code: "DEN", hex: "#2B2B2D", file: "401-den.png", delta: 300000 }
        ], basePrice: 4690000 }
    }),
    buildProduct({
        id: 402, brand: "Aula", deviceType: "keyboard", name: "Aula F75", slug: "aula-f75", skuBase: "AULAF75",
        intro: [
            "Aula F75 là bàn phím cơ không dây layout 75% gọn gàng, thiết kế gasket cho cảm giác gõ êm và có độ nảy nhẹ.",
            "Núm xoay chỉnh âm lượng tiện lợi và hàng phím chức năng đầy đủ trong thân máy nhỏ gọn.",
            "Ba chế độ kết nối gồm cáp USB-C, Bluetooth và 2,4GHz, chuyển đổi nhanh giữa nhiều máy tính và laptop.",
            "Công tắc có thể thay nóng (hot-swap) để người dùng tự đổi switch theo sở thích mà không cần hàn.",
            "Đèn nền RGB nhiều hiệu ứng và nhiều phối màu keycap để chọn theo phong cách bàn làm việc của bạn."
        ],
        specs: [
            "Layout: 75% có núm xoay âm lượng",
            "Kết nối: USB-C có dây, Bluetooth, 2,4GHz không dây",
            "Kết cấu: Gasket mount, hot-swap",
            "Đèn nền: RGB",
            "Pin: 4000 mAh, sạc lại qua USB-C"
        ],
        primary: { name: COLOR, values: [
            { value: "Xanh nhạt", code: "XNH", hex: "#C9D6E3", file: "402-light-blue.png" },
            { value: "Đen", code: "DEN", hex: "#1C1F2B", file: "402-black.png" },
            { value: "Be tím", code: "BTI", hex: "#D9C8BF", file: "402-green.png" }
        ] },
        secondary: { name: "Switch", values: [
            { value: "Reaper Linear", code: "REAPER", price: 1290000 },
            { value: "Crescent Linear", code: "CRESCENT", price: 1390000 }
        ] }
    }),
    buildProduct({
        id: 403, brand: "Aula", deviceType: "keyboard", name: "Aula F87 Pro", slug: "aula-f87-pro", skuBase: "AULAF87",
        intro: [
            "Aula F87 Pro là bàn phím cơ không dây layout TKL 87 phím, giữ lại cụm điều hướng và phím mũi tên đầy đủ.",
            "Thiết kế gasket cùng PCB khe cắt giúp phím gõ êm, ít vọng tiếng và phản hồi đều tay.",
            "Độ trễ thấp khoảng 3 ms, chuyển nhanh giữa ba chế độ USB-C, Bluetooth và 2,4GHz.",
            "Mạch hot-swap cho phép thay switch dễ dàng, hợp cho cả người mới làm quen bàn phím cơ.",
            "Nhiều phối màu phím nổi bật, đèn nền RGB và pin dung lượng lớn cho cả tuần làm việc."
        ],
        specs: [
            "Layout: TKL 87 phím",
            "Kết nối: USB-C có dây, Bluetooth, 2,4GHz không dây",
            "Kết cấu: Gasket mount, PCB khe cắt, plate PC, hot-swap",
            "Độ trễ: khoảng 3 ms",
            "Đèn nền: RGB"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#1D2326", file: "403-black.png" },
            { value: "Trắng xanh lá", code: "TXL", hex: "#EEF0EA", file: "403-white-green.png" },
            { value: "Xanh khói", code: "XKH", hex: "#DFE3E8", file: "403-smoke-blue.png" }
        ] },
        secondary: { name: "Switch", values: [
            { value: "Greywood V4 Linear", code: "GREYWOOD", price: 1490000 },
            { value: "Nimbus V3", code: "NIMBUS", price: 1590000 }
        ] }
    }),
    buildProduct({
        id: 404, brand: "Logitech", deviceType: "keyboard", name: "Logitech MX Keys S", slug: "logitech-mx-keys-s", skuBase: "MXKEYSS",
        intro: [
            "Logitech MX Keys S là bàn phím không dây cao cấp dành cho người làm việc văn phòng và sáng tạo nội dung.",
            "Phím hình lõm ôm vân tay cho cảm giác gõ chính xác, êm và ổn định suốt ngày dài.",
            "Đèn nền thông minh tự sáng khi tay đến gần và tự điều chỉnh theo ánh sáng môi trường.",
            "Kết nối Logi Bolt hoặc Bluetooth, ghép được 3 thiết bị và chuyển đổi chỉ với một phím bấm.",
            "Pin sạc qua USB-C dùng đến 10 ngày khi bật đèn nền, hoặc đến 5 tháng khi tắt đèn nền."
        ],
        specs: [
            "Kiểu bàn phím: Không dây, full-size",
            "Kết nối: Logi Bolt, Bluetooth (ghép 3 thiết bị)",
            "Đèn nền: Smart Illumination",
            "Pin: Sạc USB-C, đến 10 ngày (bật đèn) / 5 tháng (tắt đèn)",
            "Trọng lượng: khoảng 810 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Xám Graphite", code: "GRA", hex: "#3B3D40", file: "404-graphite.png" },
            { value: "Xám nhạt", code: "PGR", hex: "#D9DADB", file: "404-pale-gray.png" }
        ], basePrice: 3190000 }
    }),
    buildProduct({
        id: 405, brand: "Keychron", deviceType: "keyboard", name: "Keychron K2 V2", slug: "keychron-k2-v2", skuBase: "KEYK2V2",
        intro: [
            "Keychron K2 V2 là bàn phím cơ không dây layout 75% nổi tiếng, nhỏ gọn nhưng vẫn giữ đầy đủ phím mũi tên.",
            "Hỗ trợ Mac, Windows và Linux, kèm bộ keycap cho cả hai hệ điều hành và công tắc gạt chuyển nhanh.",
            "Bluetooth 5.1 kết nối đến 3 thiết bị và có thể cắm cáp USB-C để dùng có dây với độ trễ thấp.",
            "Pin 4000 mAh dùng đến khoảng 240 giờ khi tắt đèn nền, đủ cho nhiều tuần sử dụng.",
            "Hai tùy chọn khung nhựa xám hoặc khung nhôm đen, cùng ba lựa chọn switch Gateron đỏ, xanh và nâu."
        ],
        specs: [
            "Layout: 75%",
            "Kết nối: Bluetooth 5.1 (3 thiết bị), USB-C có dây",
            "Switch: Gateron G Pro, hot-swap",
            "Keycap: ABS, có bộ keycap Mac và Windows",
            "Pin: 4000 mAh, đến khoảng 240 giờ khi tắt đèn nền",
            "Hệ điều hành: Mac, Windows, Linux"
        ],
        primary: { name: COLOR, values: [
            { value: "Xám khung nhựa", code: "XAM", hex: "#7D8085", file: "405-xam-khung-nhua.png", delta: 0 },
            { value: "Đen khung nhôm", code: "DEN", hex: "#2B2C2F", file: "405-den-khung-nhom.png", delta: 400000 }
        ] },
        secondary: { name: "Switch", values: [
            { value: "Gateron G Pro Red", code: "RED", price: 2090000 },
            { value: "Gateron G Pro Blue", code: "BLUE", price: 2090000 },
            { value: "Gateron G Pro Brown", code: "BROWN", price: 2090000 }
        ] }
    }),
    buildProduct({
        id: 406, brand: "Keychron", deviceType: "keyboard", name: "Keychron Q1 Max", slug: "keychron-q1-max", skuBase: "KEYQ1MAX",
        intro: [
            "Keychron Q1 Max là bàn phím cơ custom layout 75% thân nhôm nguyên khối với núm xoay, hỗ trợ không dây 2,4GHz và Bluetooth.",
            "Cấu trúc gasket cùng plate PC và lớp đệm cho âm gõ trầm, đầm và cảm giác gõ nảy nhẹ.",
            "Hot-swap cho cả switch 3 chân và 5 chân, tùy biến phím bằng phần mềm QMK/VIA hoặc Keychron Launcher.",
            "Keycap KSA PBT double-shot bền màu, đèn RGB hướng nam hiển thị rõ ký tự trên keycap.",
            "Pin 4000 mAh dùng đến khoảng 180 giờ khi tắt đèn, tốc độ báo cáo 1000Hz cho game thủ."
        ],
        specs: [
            "Layout: 75% ANSI, có núm xoay",
            "Kết nối: 2,4GHz, Bluetooth (3 thiết bị), USB-C có dây; tốc độ 1000Hz",
            "Kết cấu: Thân nhôm CNC, gasket mount, plate PC, hot-swap",
            "Keycap: KSA PBT double-shot",
            "Phần mềm: QMK / VIA, Keychron Launcher",
            "Pin: 4000 mAh, đến khoảng 180 giờ khi tắt đèn nền",
            "Kích thước và khối lượng: 145 x 327,5 mm, khoảng 1724 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen Carbon", code: "CAR", hex: "#2A2C30", file: "406-carbon-black.png" },
            { value: "Trắng Vỏ Sò", code: "SHW", hex: "#E6E6DE", file: "406-shell-white.png" },
            { value: "Tím", code: "TIM", hex: "#4B3A78", file: "406-purple.png" }
        ] },
        secondary: { name: "Switch", values: [
            { value: "Gateron Jupiter Brown", code: "BROWN", price: 5290000 },
            { value: "Gateron Jupiter Red", code: "RED", price: 5290000 },
            { value: "Gateron Jupiter Banana", code: "BANANA", price: 5290000 }
        ] }
    }),

    // ===== Chuột =====
    buildProduct({
        id: 501, brand: "Apple", deviceType: "mouse", name: "Apple Magic Mouse", slug: "apple-magic-mouse", skuBase: "MAGICMOUSE",
        intro: [
            "Magic Mouse là chuột không dây của Apple với bề mặt cảm ứng Multi-Touch cho phép vuốt và cuộn bằng một ngón tay.",
            "Thiết kế liền khối mỏng, nhẹ, trượt êm nhờ phần đế tối ưu cho mặt bàn.",
            "Ghép nối Bluetooth tự động với Mac, dùng ngay không cần cài thêm phần mềm.",
            "Pin tích hợp sạc lại qua cổng USB-C, kèm sẵn cáp trong hộp.",
            "Hai tùy chọn bề mặt Multi-Touch màu trắng hoặc đen phù hợp với Mac và Magic Keyboard."
        ],
        specs: [
            "Kiểu chuột: Không dây, bề mặt Multi-Touch",
            "Kết nối: Bluetooth",
            "Sạc pin: Cổng USB-C, cáp đi kèm",
            "Tương thích: Mac"
        ],
        primary: { name: COLOR, values: [
            { value: "Trắng", code: "TRG", hex: "#F2F2F4", file: "501-trang.png", delta: 0 },
            { value: "Đen", code: "DEN", hex: "#2B2B2D", file: "501-den.png", delta: 300000 }
        ], basePrice: 2290000 }
    }),
    buildProduct({
        id: 502, brand: "Logitech", deviceType: "mouse", name: "Logitech MX Master 3S", slug: "logitech-mx-master-3s", skuBase: "MXMASTER3S",
        intro: [
            "Logitech MX Master 3S là chuột không dây cao cấp cho dân văn phòng và nhà sáng tạo, thiết kế ôm tay theo thái công học.",
            "Cảm biến Darkfield 8000 DPI hoạt động chính xác trên mọi bề mặt, kể cả mặt kính.",
            "Bánh xe cuộn điện từ MagSpeed cuộn nhanh, êm và chính xác, phím bấm yên tĩnh hơn khoảng 90%.",
            "Kết nối Logi Bolt hoặc Bluetooth, dùng được với nhiều máy và chuyển đổi bằng một nút bấm.",
            "Pin sạc USB-C dùng đến 70 ngày, sạc nhanh 3 phút cho khoảng 3 giờ sử dụng."
        ],
        specs: [
            "Cảm biến: Darkfield, 200 - 8000 DPI",
            "Số nút bấm: 8 nút, bánh xe MagSpeed",
            "Kết nối: Logi Bolt, Bluetooth",
            "Pin: Sạc USB-C, đến 70 ngày",
            "Kích thước: 124,9 x 84,3 x 51 mm",
            "Trọng lượng: 141 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Xám Graphite", code: "GRA", hex: "#3A3C3F", file: "502-graphite.png" },
            { value: "Đen", code: "DEN", hex: "#1B1B1D", file: "502-black.png" }
        ], basePrice: 2390000 }
    }),
    buildProduct({
        id: 503, brand: "Logitech", deviceType: "mouse", name: "Logitech G Pro X Superlight 2", slug: "logitech-g-pro-x-superlight-2", skuBase: "GPXSL2",
        intro: [
            "Logitech G Pro X Superlight 2 là chuột gaming không dây siêu nhẹ chỉ khoảng 60 g, được game thủ chuyên nghiệp tin dùng.",
            "Cảm biến HERO 2 cho độ chính xác cao, theo dõi mượt ở tốc độ di chuột lớn.",
            "Công nghệ LIGHTSPEED không dây và tốc độ báo cáo đến 8 kHz giảm độ trễ tối đa cho game bắn súng.",
            "Công tắc lai quang - cơ LIGHTFORCE bền đến 70 triệu lần bấm, chân chuột PTFE trượt mượt.",
            "Pin sạc USB-C dùng đến khoảng 95 giờ, tương thích đế sạc không dây POWERPLAY."
        ],
        specs: [
            "Cảm biến: HERO 2, tối đa 44.000 DPI",
            "Kết nối: LIGHTSPEED không dây, tốc độ báo cáo đến 8 kHz",
            "Công tắc: LIGHTFORCE lai quang - cơ",
            "Số nút bấm: 5 nút",
            "Pin: Sạc USB-C, đến khoảng 95 giờ",
            "Trọng lượng: 60 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#111111", file: "503-black.png" },
            { value: "Trắng", code: "TRG", hex: "#F2F2F2", file: "503-white.png" },
            { value: "Hồng Magenta", code: "MAG", hex: "#C8104E", file: "503-magenta.png" }
        ], basePrice: 3990000 }
    }),
    buildProduct({
        id: 504, brand: "Razer", deviceType: "mouse", name: "Razer Viper V3 Pro", slug: "razer-viper-v3-pro", skuBase: "VIPERV3PRO",
        intro: [
            "Razer Viper V3 Pro là chuột gaming không dây siêu nhẹ, thiết kế đối xứng dành cho game thủ esport tốc độ cao.",
            "Thân chuột chỉ nặng khoảng 54 g, chân trượt PTFE lớn giúp di chuyển mượt và ổn định trên mọi loại bàn di.",
            "Cảm biến quang Focus Pro 35K Gen-2 cho độ chính xác cao và khả năng theo dõi ổn định ở tốc độ di chuột lớn.",
            "Kết nối HyperSpeed 2,4GHz độ trễ thấp, hỗ trợ tốc độ báo cáo đến 8000 Hz với bộ thu HyperPolling.",
            "Công tắc quang học Razer thế hệ 3 phản hồi tức thì, pin sạc USB-C dùng đến khoảng 95 giờ."
        ],
        specs: [
            "Cảm biến: Focus Pro 35K Gen-2 quang học, tối đa 35.000 DPI",
            "Kết nối: HyperSpeed 2,4GHz không dây, USB-C có dây; tốc độ báo cáo đến 8000 Hz (HyperPolling)",
            "Công tắc: Quang học Razer Gen-3",
            "Pin: Sạc USB-C, đến khoảng 95 giờ",
            "Trọng lượng: khoảng 54 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#111111", file: "504-black.png" },
            { value: "Trắng", code: "TRG", hex: "#F2F2F2", file: "504-white.png" }
        ], basePrice: 3990000 }
    }),

    // ===== Tai nghe =====
    buildProduct({
        id: 601, brand: "Apple", deviceType: "headphone", name: "Apple AirPods Max", slug: "apple-airpods-max", skuBase: "AIRPODSMAX",
        intro: [
            "AirPods Max là tai nghe chụp tai không dây cao cấp của Apple với chất âm chi tiết, cân bằng và sâu.",
            "Chống ồn chủ động ANC loại bỏ tiếng ồn xung quanh, chế độ Xuyên âm giúp nghe môi trường khi cần.",
            "Chip H2 xử lý âm thanh tính toán, hỗ trợ Âm thanh thích ứng và Âm thanh không gian với theo dõi chuyển động đầu.",
            "Khung thép không gỉ, đệm tai bằng bọt nhớ và dây đeo lưới thoáng giúp đeo thoải mái trong thời gian dài.",
            "Pin dùng đến khoảng 20 giờ, sạc qua cổng USB-C và ghép nối nhanh với Mac cùng các thiết bị Apple khác."
        ],
        specs: [
            "Kiểu tai nghe: Chụp tai không dây (over-ear)",
            "Chip xử lý: Apple H2",
            "Tính năng: Chống ồn chủ động, Âm thanh thích ứng, Âm thanh không gian",
            "Pin: Đến 20 giờ nghe nhạc",
            "Cổng sạc: USB-C",
            "Trọng lượng: khoảng 385 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen Midnight", code: "MID", hex: "#2E3036", file: "601-midnight.png" },
            { value: "Trắng Starlight", code: "STA", hex: "#EBE6DC", file: "601-starlight.png" },
            { value: "Xanh Blue", code: "BLU", hex: "#A7C3D6", file: "601-blue.png" }
        ], basePrice: 13990000 }
    }),
    buildProduct({
        id: 602, brand: "Razer", deviceType: "headphone", name: "Razer BlackShark V2 Pro", slug: "razer-blackshark-v2-pro", skuBase: "BSV2PRO",
        intro: [
            "Razer BlackShark V2 Pro là tai nghe gaming không dây dành cho game thủ esport muốn âm thanh vị trí chính xác.",
            "Driver TriForce Titanium 50 mm cho âm cao trong, trung rõ và bass chắc.",
            "Micro HyperClear Supercardioid tháo rời thu giọng nói rõ và hạn chế tiếng ồn xung quanh.",
            "Kết nối HyperSpeed 2,4GHz độ trễ thấp hoặc Bluetooth 5.2, hỗ trợ THX Spatial Audio.",
            "Pin dùng đến khoảng 70 giờ, đệm tai mềm và khung nhẹ phù hợp những trận đấu dài."
        ],
        specs: [
            "Kiểu tai nghe: Chụp tai không dây (over-ear)",
            "Driver: TriForce Titanium 50 mm",
            "Kết nối: HyperSpeed 2,4GHz, Bluetooth 5.2",
            "Micro: HyperClear Supercardioid, tháo rời",
            "Pin: Đến khoảng 70 giờ",
            "Trọng lượng: khoảng 320 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#111111", file: "602-black.png" },
            { value: "Trắng", code: "TRG", hex: "#F2F2F2", file: "602-white.png" }
        ], basePrice: 4990000 }
    }),
    buildProduct({
        id: 603, brand: "Logitech", deviceType: "headphone", name: "Logitech G Pro X 2 Lightspeed", slug: "logitech-g-pro-x-2-lightspeed", skuBase: "GPROX2",
        intro: [
            "Logitech G Pro X 2 Lightspeed là tai nghe gaming không dây dành cho game thủ esport và streamer.",
            "Driver graphene 50 mm cho âm thanh rõ ràng, dải động rộng và định vị chính xác trong game.",
            "Kết nối LIGHTSPEED, Bluetooth hoặc dây 3,5 mm / USB, linh hoạt giữa PC, console và điện thoại.",
            "Micro cardioid tháo rời với công nghệ Blue VO!CE lọc ồn và làm đẹp giọng nói khi livestream.",
            "Pin dùng đến khoảng 50 giờ, phạm vi kết nối không dây đến khoảng 30 m."
        ],
        specs: [
            "Kiểu tai nghe: Chụp tai không dây (over-ear)",
            "Driver: Graphene 50 mm",
            "Kết nối: LIGHTSPEED, Bluetooth, 3,5 mm / USB",
            "Micro: Cardioid tháo rời, Blue VO!CE",
            "Âm thanh vòm: DTS Headphone:X 2.0",
            "Pin: Đến khoảng 50 giờ",
            "Trọng lượng: khoảng 345 g"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#111111", file: "603-black.png" },
            { value: "Trắng", code: "TRG", hex: "#EEEEEE", file: "603-white.png" },
            { value: "Hồng Magenta", code: "MAG", hex: "#D8195A", file: "603-magenta.png" }
        ], basePrice: 5490000 }
    }),

    // ===== Màn hình =====
    buildProduct({
        id: 701, brand: "Samsung", deviceType: "monitor", name: "Samsung Odyssey G5 G55C", slug: "samsung-odyssey-g5-g55c", skuBase: "ODYG55C", image: "701-black.png",
        intro: [
            "Samsung Odyssey G5 G55C là màn hình gaming cong 1000R độ phân giải QHD, mang lại trải nghiệm đắm chìm.",
            "Tần số quét 165Hz và thời gian phản hồi 1 ms (MPRT) cho hình ảnh mượt, hạn chế xé hình khi chơi game.",
            "Tấm nền VA tương phản cao 2500:1 cho màu đen sâu, chi tiết rõ ở cả cảnh tối.",
            "Hỗ trợ AMD FreeSync và HDR10, tương thích tốt với card đồ họa hiện đại.",
            "Có hai kích thước 27 inch và 32 inch để chọn theo không gian bàn làm việc."
        ],
        specs: [
            "Kích thước: 27 inch hoặc 32 inch",
            "Độ phân giải: 2560 x 1440 (QHD)",
            "Tấm nền: VA cong 1000R",
            "Tần số quét: 165Hz, phản hồi 1 ms (MPRT)",
            "Độ sáng và tương phản: 300 nits, 2500:1",
            "Cổng kết nối: HDMI 2.0, DisplayPort 1.2",
            "Công nghệ: AMD FreeSync, HDR10"
        ],
        secondary: { name: "Kích thước", values: [
            { value: '27"', code: "27", price: 6990000 },
            { value: '32"', code: "32", price: 8990000 }
        ] }
    }),
    buildProduct({
        id: 702, brand: "MSI", deviceType: "monitor", name: "MSI Optix MAG274QRF-QD", slug: "msi-optix-mag274qrf-qd", skuBase: "MAG274QRF", image: "702-black.png",
        intro: [
            "MSI Optix MAG274QRF-QD là màn hình gaming 27 inch QHD dùng tấm nền Rapid IPS kết hợp Quantum Dot.",
            "Tần số quét 165Hz, thời gian phản hồi 1 ms (GTG) cho chuyển động mượt và rõ nét.",
            "Công nghệ Quantum Dot cho dải màu rộng khoảng 97% DCI-P3, màu sắc tươi và chính xác.",
            "Hỗ trợ G-Sync Compatible và FreeSync Premium, có cổng USB-C xuất hình và sạc 15W.",
            "Chân đế chỉnh được độ cao, xoay, nghiêng và xoay dọc, linh hoạt cho mọi tư thế làm việc."
        ],
        specs: [
            "Kích thước: 27 inch",
            "Độ phân giải: 2560 x 1440 (QHD)",
            "Tấm nền: Rapid IPS, Quantum Dot (97% DCI-P3)",
            "Tần số quét: 165Hz, phản hồi 1 ms (GTG)",
            "Độ sáng và tương phản: 300 nits, 1000:1",
            "Cổng kết nối: 1 x DisplayPort 1.2a, 2 x HDMI 2.0b, 1 x USB-C (DP Alt, 15W)",
            "Điều chỉnh chân đế: Nghiêng, xoay, xoay dọc, chỉnh độ cao"
        ],
        secondary: { name: "Phiên bản", values: [
            { value: "MAG274QRF-QD", code: "QD", price: 7490000 },
            { value: "MAG274QRF-QD E2", code: "QDE2", price: 7990000 }
        ] }
    }),
    buildProduct({
        id: 703, brand: "Asus", deviceType: "monitor", name: "Asus ProArt Display PA278CV", slug: "asus-proart-display-pa278cv", skuBase: "PA278", image: "703-silver.png",
        intro: [
            "Asus ProArt Display PA278CV là màn hình 27 inch dành cho nhà thiết kế, nhiếp ảnh gia và người dựng video.",
            "Tấm nền IPS độ phân giải QHD phủ 100% sRGB và Rec.709, sai lệch màu Delta E dưới 2 đã được hiệu chuẩn.",
            "Cổng USB-C hỗ trợ truyền hình ảnh và sạc laptop công suất đến 65W, chỉ một dây cáp duy nhất.",
            "Hub USB 3.2 tích hợp, DisplayPort hỗ trợ daisy chain để mở rộng nhiều màn hình.",
            "Chân đế chỉnh độ cao, nghiêng, xoay và xoay dọc, tương thích gắn giá treo VESA."
        ],
        specs: [
            "Kích thước: 27 inch",
            "Độ phân giải: 2560 x 1440 (QHD)",
            "Tấm nền: IPS, 100% sRGB / Rec.709, Delta E < 2",
            "Tần số quét: 75Hz, phản hồi 5 ms (GTG)",
            "Độ sáng và tương phản: 350 nits, 1000:1",
            "Cổng kết nối: USB-C (DP Alt, PD 65W), 2 x DisplayPort 1.2, HDMI 1.4, 4 x USB 3.2 Gen 1 Type-A",
            "Khối lượng: 8,7 kg"
        ],
        secondary: { name: "Phiên bản", values: [
            { value: "PA278CV (USB-C)", code: "CV", price: 8490000 },
            { value: "PA278QV", code: "QV", price: 7290000 }
        ] }
    }),
    buildProduct({
        id: 704, brand: "Asus", deviceType: "monitor", name: "Asus TUF Gaming VG27AQ", slug: "asus-tuf-gaming-vg27aq", skuBase: "VG27AQ", image: "704-black.png",
        intro: [
            "Asus TUF Gaming VG27AQ là màn hình gaming 27 inch QHD tấm nền IPS với tần số quét cao.",
            "Tần số quét 165Hz (ép xung) và thời gian phản hồi 1 ms (MPRT) cho hình ảnh mượt trong game bắn súng và đua xe.",
            "Công nghệ ELMB Sync giảm nhòe chuyển động đồng thời không xé hình, tương thích G-Sync Compatible.",
            "Hỗ trợ HDR10, phủ 100% sRGB cho màu sắc trung thực khi chơi game lẫn làm việc.",
            "Thiết kế TUF bền bỉ, chân đế chỉnh độ cao, xoay, nghiêng và xoay dọc linh hoạt."
        ],
        specs: [
            "Kích thước: 27 inch",
            "Độ phân giải: 2560 x 1440 (QHD)",
            "Tấm nền: IPS, 100% sRGB",
            "Tần số quét: 165Hz (ép xung), phản hồi 1 ms (MPRT)",
            "Độ sáng và tương phản: 350 nits, 1000:1",
            "Cổng kết nối: 1 x DisplayPort 1.2, 2 x HDMI 2.0, jack tai nghe",
            "Công nghệ: ELMB Sync, G-Sync Compatible, HDR10"
        ],
        secondary: { name: "Phiên bản", values: [
            { value: "VG27AQ", code: "BASE", price: 6990000 },
            { value: "VG27AQ1A", code: "1A", price: 7290000 }
        ] }
    }),

    // ===== Ổ cứng SSD =====
    buildProduct({
        id: 801, brand: "Samsung", deviceType: "storage", name: "Samsung Portable SSD T7 Shield", slug: "samsung-portable-ssd-t7-shield", skuBase: "T7SHIELD",
        intro: [
            "Samsung Portable SSD T7 Shield là ổ SSD di động tốc độ cao với lớp vỏ cao su chống sốc, chống bụi và nước chuẩn IP65.",
            "Giao tiếp USB 3.2 Gen 2 cho tốc độ đọc đến 1.050 MB/s và ghi đến 1.000 MB/s, sao chép phim 4K trong vài giây.",
            "Chịu được cú rơi từ độ cao đến 3 m, phù hợp người thường xuyên mang dữ liệu đi lại.",
            "Nhỏ gọn chỉ khoảng 98 g, tương thích PC, Mac, máy chơi game và điện thoại hỗ trợ USB-C.",
            "Bảo hành 3 năm, có ba tùy chọn màu và hai mức dung lượng 1TB hoặc 2TB."
        ],
        specs: [
            "Giao tiếp: USB 3.2 Gen 2 (USB-C)",
            "Tốc độ đọc/ghi: Đến 1.050 MB/s / 1.000 MB/s",
            "Độ bền: Chuẩn IP65, chịu rơi 3 m",
            "Trọng lượng: khoảng 98 g",
            "Bảo hành: 3 năm"
        ],
        primary: { name: COLOR, values: [
            { value: "Đen", code: "DEN", hex: "#25262B", file: "801-black.png" },
            { value: "Xanh dương", code: "XDU", hex: "#2A3A9C", file: "801-blue.png" },
            { value: "Be", code: "BE", hex: "#D8CDB9", file: "801-beige.png" }
        ] },
        secondary: { name: "Dung lượng", values: [
            { value: "1TB", code: "1TB", price: 3290000 },
            { value: "2TB", code: "2TB", price: 5790000 }
        ] }
    }),
    buildProduct({
        id: 802, brand: "Samsung", deviceType: "storage", name: "Samsung 990 PRO NVMe M.2", slug: "samsung-990-pro-nvme-m2", skuBase: "SS990PRO",
        intro: [
            "Samsung 990 PRO là ổ SSD NVMe M.2 PCIe 4.0 hiệu năng cao dành cho game thủ và người dựng phim chuyên nghiệp.",
            "Tốc độ đọc tuần tự đến 7.450 MB/s và ghi đến 6.900 MB/s, rút ngắn thời gian tải game và xuất video.",
            "Bộ nhớ V-NAND TLC và bộ đệm LPDDR4 giúp giữ hiệu năng ổn định khi tải nặng.",
            "Có phiên bản kèm tản nhiệt tương thích PlayStation 5 và phiên bản không tản nhiệt cho laptop, PC.",
            "Bảo hành 5 năm hoặc đến mức TBW tối đa, bản 1TB chịu được 600 TBW."
        ],
        specs: [
            "Chuẩn giao tiếp: M.2 2280, PCIe 4.0 x4, NVMe 2.0",
            "Tốc độ đọc/ghi tuần tự: Đến 7.450 MB/s / 6.900 MB/s (bản 1TB)",
            "Độ bền: 600 TBW (bản 1TB)",
            "Bộ nhớ: Samsung V-NAND TLC, bộ đệm 1GB LPDDR4",
            "Bảo hành: 5 năm"
        ],
        primary: { name: "Tản nhiệt", values: [
            { value: "Không tản nhiệt", code: "STD", file: "802-black.png", delta: 0 },
            { value: "Có tản nhiệt", code: "HS", file: "802-heatsink.png", delta: 400000 }
        ] },
        secondary: { name: "Dung lượng", values: [
            { value: "1TB", code: "1TB", price: 3490000 },
            { value: "2TB", code: "2TB", price: 5990000 }
        ] }
    })
];

const seedData = {
    "administrator": {
        "username": "admin123"
    },
    "catalog": {
        "brands": [...BRANDS],
        "deviceTypes": [...DEVICE_TYPES]
    },
    "commerce": {
        "products": products,
        "audits": []
    }
};

// Demo customers, vouchers, orders and reviews are generated deterministically (see seed-fixtures.js);
// only their timestamps are relative to the moment this module is loaded.
Object.assign(seedData.commerce, buildSeedFixtures(seedData.commerce.products, new Date()));

module.exports = seedData;
