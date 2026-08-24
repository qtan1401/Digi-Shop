// ===== PAYMENT.JS =====
// File này xử lý trang thanh toán (checkout)
// Hiển thị sản phẩm được chọn, cho phép chọn số lượng, và xác nhận thanh toán

/**
 * Lấy giá trị của parameter từ URL
 */
const getUrlParam = (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

/**
 * Format giá tiền sang dạng VNĐ
 */
const formatPrice = (price) => {
    return price.toLocaleString("vi-VN") + "₫";
};

/**
 * Biến lưu trữ trạng thái
 */
let currentProduct = null;
let currentQuantity = 1;

/**
 * Cập nhật hiển thị tổng tiền
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
 * Tăng số lượng
 */
const increaseQty = () => {
    if (currentProduct && currentQuantity < currentProduct.stock) {
        currentQuantity++;
        updateTotal();
    }
};

/**
 * Giảm số lượng
 */
const decreaseQty = () => {
    if (currentQuantity > 1) {
        currentQuantity--;
        updateTotal();
    }
};

/**
 * Xử lý thanh toán
 */
const handleCheckout = async () => {
    if (!currentProduct) return;

    const btnEl = document.getElementById("btn-checkout");
    btnEl.textContent = "Đang xử lý...";
    btnEl.disabled = true;

    try {
        const res = await fetch(`/api/checkout/${currentProduct.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity: currentQuantity })
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message);
        }

        btnEl.textContent = "Thanh toán thành công ✓";
        btnEl.style.background = "#27774D";
    } catch (error) {
        btnEl.textContent = "Xác nhận thanh toán";
        btnEl.disabled = false;
        alert("Lỗi: " + error.message);
    }
};

/**
 * Fetch thông tin sản phẩm và render trang thanh toán
 */
const loadCheckout = async () => {
    const id = getUrlParam("id");
    const container = document.getElementById("payment-info");

    if (!id) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Không có ID sản phẩm trong URL</p>
            </div>
        `;
        return;
    }

    try {
        const res = await fetch(`/api/products/info/${id}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message);
        }

        currentProduct = data.data;
        currentQuantity = 1;

        container.innerHTML = `
            <div class="checkout-card">
                <div class="checkout-card__product">
                    <img src="${currentProduct.image}" alt="${currentProduct.name}" class="checkout-card__image">
                    <div class="checkout-card__info">
                        <h2 class="checkout-card__name">${currentProduct.name}</h2>
                        <p class="checkout-card__desc">${currentProduct.description}</p>
                        <span class="checkout-card__price">${formatPrice(currentProduct.price)}</span>
                    </div>
                </div>
                <div class="checkout-card__form">
                    <div class="checkout-form-row">
                        <label>Số lượng</label>
                        <div class="quantity-input">
                            <button type="button" onclick="decreaseQty()">−</button>
                            <input type="number" id="qty-input" value="1" min="1" max="${currentProduct.stock}" readonly>
                            <button type="button" onclick="increaseQty()">+</button>
                        </div>
                    </div>
                    <div class="checkout-divider"></div>
                    <div class="checkout-total">
                        <span class="checkout-total__label">Tổng cộng</span>
                        <span class="checkout-total__price" id="checkout-total-price">${formatPrice(currentProduct.price)}</span>
                    </div>
                    <button class="btn btn--primary btn--checkout" id="btn-checkout" onclick="handleCheckout()">
                        Xác nhận thanh toán
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${error.message}</p>
            </div>
        `;
    }
};

// Chạy khi trang load xong
document.addEventListener("DOMContentLoaded", loadCheckout);