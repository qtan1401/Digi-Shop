// ===== PAYMENT.JS =====
// File này xử lý toàn bộ giao diện và tương tác trang thanh toán (checkout)
// Luồng hoạt động: Lấy ID sản phẩm → Gọi API lấy thông tin → Hiển thị form đặt hàng → Gửi yêu cầu thanh toán → Hiển thị hóa đơn thành công

/**
 * Lấy giá trị tham số (param) từ URL Query String
 * Ví dụ: checkouts.html?id=1 → getUrlParam("id") trả về "1"
 * @param {string} param - Tên tham số cần lấy
 * @returns {string|null} Giá trị của tham số
 */
const getUrlParam = (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

/**
 * Format giá tiền sang dạng VNĐ (Ví dụ: 34990000 → "34.990.000₫")
 * @param {number} price - Giá tiền
 * @returns {string} Chuỗi định dạng tiền tệ VNĐ
 */
const formatPrice = (price) => {
    return price.toLocaleString("vi-VN") + "₫";
};

// Biến lưu trữ trạng thái sản phẩm hiện tại và số lượng đặt mua
let currentProduct = null;
let currentQuantity = 1;

/**
 * Cập nhật tổng tiền khi thay đổi số lượng
 */
const updateTotal = () => {
    if (!currentProduct) return;
    const totalEl = document.getElementById("checkout-total-price");
    if (totalEl) {
        totalEl.textContent = formatPrice(currentProduct.price * currentQuantity);
    }
    const qtyInput = document.getElementById("qty-input");
    if (qtyInput) {
        qtyInput.value = currentQuantity;
    }
};

/**
 * Tăng số lượng mua (không vượt quá số lượng tồn kho)
 */
const increaseQty = () => {
    if (currentProduct && currentQuantity < currentProduct.stock) {
        currentQuantity++;
        updateTotal();
    }
};

/**
 * Giảm số lượng mua (tối thiểu là 1)
 */
const decreaseQty = () => {
    if (currentQuantity > 1) {
        currentQuantity--;
        updateTotal();
    }
};

/**
 * Hiển thị màn hình thông báo thanh toán thành công kèm chi tiết đơn hàng
 * @param {Object} order - Dữ liệu đơn hàng vừa được tạo từ backend
 */
const renderOrderSuccess = (order) => {
    const container = document.getElementById("payment-info");
    container.innerHTML = `
        <div class="order-success-card">
            <div class="order-success-icon">✓</div>
            <h2 class="order-success-title">Đặt hàng & Thanh toán thành công!</h2>
            <p class="order-success-desc">Cảm ơn bạn đã mua sắm tại NodeShop. Đơn hàng của bạn đã được ghi nhận.</p>
            
            <div class="order-detail-box">
                <div class="order-detail-row">
                    <span class="order-detail-label">Mã đơn hàng</span>
                    <span class="order-detail-value font-mono"><strong>${order.id}</strong></span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Thời gian đặt</span>
                    <span class="order-detail-value">${order.createdAt}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Khách hàng</span>
                    <span class="order-detail-value">${order.customer.name}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Số điện thoại</span>
                    <span class="order-detail-value">${order.customer.phone || "Không có"}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Địa chỉ nhận hàng</span>
                    <span class="order-detail-value">${order.customer.address}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Phương thức thanh toán</span>
                    <span class="order-detail-value">${order.paymentMethod}</span>
                </div>
                ${order.customer.note ? `
                <div class="order-detail-row">
                    <span class="order-detail-label">Ghi chú</span>
                    <span class="order-detail-value">${order.customer.note}</span>
                </div>` : ''}
                <div class="order-detail-row">
                    <span class="order-detail-label">Sản phẩm</span>
                    <span class="order-detail-value">${order.product.name} (x${order.quantity})</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Đơn giá</span>
                    <span class="order-detail-value">${formatPrice(order.unitPrice)}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Tổng thanh toán</span>
                    <span class="order-detail-value order-detail-value--highlight">${formatPrice(order.totalPrice)}</span>
                </div>
            </div>

            <div class="order-actions">
                <a href="/" class="btn btn--primary">Tiếp tục mua sắm</a>
                <a href="/product_info.html?id=${order.product.id}" class="btn btn--secondary">Xem lại sản phẩm</a>
            </div>
        </div>
    `;
};

/**
 * Xử lý sự kiện khi người dùng nhấn nút "Xác nhận thanh toán"
 */
const handleCheckout = async () => {
    if (!currentProduct) return;

    // Kiểm tra tồn kho trước khi gửi request
    if (currentProduct.stock <= 0) {
        alert("Sản phẩm đã hết hàng, không thể thanh toán.");
        return;
    }

    const btnEl = document.getElementById("btn-checkout");
    const errorAlertEl = document.getElementById("checkout-error-alert");

    // Xóa thông báo lỗi cũ nếu có
    if (errorAlertEl) {
        errorAlertEl.style.display = "none";
        errorAlertEl.textContent = "";
    }

    // Lấy thông tin khách hàng từ form
    const customerName = document.getElementById("customer-name")?.value || "";
    const customerPhone = document.getElementById("customer-phone")?.value || "";
    const customerAddress = document.getElementById("customer-address")?.value || "";
    const paymentMethod = document.getElementById("payment-method")?.value || "COD";
    const note = document.getElementById("customer-note")?.value || "";

    // Đổi trạng thái nút bấm trong lúc chờ server xử lý
    btnEl.textContent = "Đang xử lý thanh toán...";
    btnEl.disabled = true;

    try {
        // Gửi HTTP POST request đến Backend API
        const res = await fetch(`/api/checkout/${currentProduct.id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                quantity: currentQuantity,
                customerName: customerName,
                customerPhone: customerPhone,
                customerAddress: customerAddress,
                paymentMethod: paymentMethod,
                note: note
            })
        });

        const data = await res.json();

        // Nếu server trả về lỗi nghiệp vụ
        if (!data.success) {
            throw new Error(data.message || "Có lỗi xảy ra trong quá trình thanh toán");
        }

        // Cập nhật lại tồn kho cục bộ
        currentProduct.stock = data.remainingStock;

        // Render màn hình đặt hàng thành công
        renderOrderSuccess(data.data);
    } catch (error) {
        // Phục hồi nút bấm
        btnEl.textContent = "Xác nhận thanh toán";
        btnEl.disabled = false;

        // Hiển thị lỗi lên giao diện
        if (errorAlertEl) {
            errorAlertEl.textContent = "⚠️ " + error.message;
            errorAlertEl.style.display = "block";
        } else {
            alert("Lỗi: " + error.message);
        }
    }
};

/**
 * Tải thông tin sản phẩm từ API và dựng giao diện trang thanh toán
 */
const loadCheckout = async () => {
    const id = getUrlParam("id");
    const container = document.getElementById("payment-info");

    // Kiểm tra xem có ID sản phẩm trên URL hay không
    if (!id) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Vui lòng chọn sản phẩm từ trang chủ trước khi thanh toán.</p>
                <div style="margin-top: 16px;">
                    <a href="/" class="btn btn--primary">Quay lại trang chủ</a>
                </div>
            </div>
        `;
        return;
    }

    try {
        // Gọi API lấy chi tiết sản phẩm
        const res = await fetch(`/api/products/info/${id}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message);
        }

        currentProduct = data.data;
        currentQuantity = 1;

        const isOutOfStock = currentProduct.stock <= 0;

        // Render giao diện thanh toán hoàn chỉnh
        container.innerHTML = `
            <div class="checkout-card">
                <!-- THÔNG TIN SẢN PHẨM -->
                <div class="checkout-card__product">
                    <img src="${currentProduct.image}" alt="${currentProduct.name}" class="checkout-card__image">
                    <div class="checkout-card__info">
                        <h2 class="checkout-card__name">${currentProduct.name}</h2>
                        <p class="checkout-card__desc">${currentProduct.description}</p>
                        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto;">
                            <span class="checkout-card__price">${formatPrice(currentProduct.price)}</span>
                            <span style="font-size: 0.85rem; color: ${isOutOfStock ? '#C0392B' : 'var(--text-secondary)'};">
                                ${isOutOfStock ? '❌ Hết hàng' : `📦 Tồn kho: ${currentProduct.stock}`}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- FORM ĐẶT HÀNG & THANH TOÁN -->
                <div class="checkout-card__form">
                    <div id="checkout-error-alert" class="checkout-alert-error" style="display: none;"></div>

                    <!-- CHỌN SỐ LƯỢNG -->
                    <div class="checkout-form-row">
                        <label for="qty-input">Số lượng đặt mua</label>
                        <div class="quantity-input">
                            <button type="button" onclick="decreaseQty()" ${isOutOfStock ? 'disabled' : ''}>−</button>
                            <input type="number" id="qty-input" value="${isOutOfStock ? 0 : 1}" min="1" max="${currentProduct.stock}" readonly>
                            <button type="button" onclick="increaseQty()" ${isOutOfStock ? 'disabled' : ''}>+</button>
                        </div>
                    </div>

                    <div class="checkout-divider"></div>

                    <!-- THÔNG TIN GIAO HÀNG -->
                    <div class="checkout-section-title">Thông tin giao hàng</div>
                    
                    <div class="checkout-grid-2">
                        <div class="checkout-input-group">
                            <label for="customer-name">Họ và tên người nhận *</label>
                            <input type="text" id="customer-name" class="checkout-input" placeholder="Ví dụ: Nguyễn Văn A" required>
                        </div>
                        <div class="checkout-input-group">
                            <label for="customer-phone">Số điện thoại *</label>
                            <input type="tel" id="customer-phone" class="checkout-input" placeholder="Ví dụ: 0912345678" required>
                        </div>
                    </div>

                    <div class="checkout-input-group">
                        <label for="customer-address">Địa chỉ nhận hàng *</label>
                        <input type="text" id="customer-address" class="checkout-input" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" required>
                    </div>

                    <div class="checkout-grid-2">
                        <div class="checkout-input-group">
                            <label for="payment-method">Phương thức thanh toán</label>
                            <select id="payment-method" class="checkout-select">
                                <option value="COD">Thanh toán khi nhận hàng (COD)</option>
                                <option value="BANKING">Chuyển khoản ngân hàng (QR Code)</option>
                            </select>
                        </div>
                        <div class="checkout-input-group">
                            <label for="customer-note">Ghi chú (Tùy chọn)</label>
                            <input type="text" id="customer-note" class="checkout-input" placeholder="Ví dụ: Giao giờ hành chính">
                        </div>
                    </div>

                    <div class="checkout-divider"></div>

                    <!-- TỔNG CỘNG TIỀN THANH TOÁN -->
                    <div class="checkout-total">
                        <span class="checkout-total__label">Tổng tiền thanh toán</span>
                        <span class="checkout-total__price" id="checkout-total-price">
                            ${formatPrice(isOutOfStock ? 0 : currentProduct.price * currentQuantity)}
                        </span>
                    </div>

                    <!-- NÚT XÁC NHẬN -->
                    <button class="btn btn--primary btn--checkout" id="btn-checkout" onclick="handleCheckout()" ${isOutOfStock ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : ''}>
                        ${isOutOfStock ? 'Sản phẩm đã hết hàng' : 'Xác nhận thanh toán'}
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${error.message}</p>
                <div style="margin-top: 16px;">
                    <a href="/" class="btn btn--primary">Quay lại trang chủ</a>
                </div>
            </div>
        `;
    }
};

// Chạy hàm loadCheckout khi trang web đã tải xong DOM
document.addEventListener("DOMContentLoaded", loadCheckout);
