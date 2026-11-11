// ===== PRODUCT_INFO.JS =====
// Trang chi tiết sản phẩm: hiển thị thông tin + nút Mua ngay + Thêm vào giỏ
// Disabled cả 2 nút khi hết hàng

const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const formatPrice = (price) => price.toLocaleString("vi-VN") + "₫";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
})[character]);

// Mô tả sản phẩm là văn bản thuần: vài dòng giới thiệu, một dòng trống, dòng "Thông số kỹ thuật",
// rồi các dòng "Nhãn: Giá trị". Dòng không có dấu ":" là tiêu đề nhóm thông số.
const SPECIFICATION_MARKER = "thông số kỹ thuật";
const LEADING_BULLET = /^(?:[•·▪●*]\s*|[-–—]\s+)/u;

const parseProductDescription = (description) => {
    const lines = String(description ?? "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(LEADING_BULLET, "").trim());
    const markerIndex = lines.findIndex((line) =>
        line.normalize("NFC").replace(/\s*:$/, "").trim().toLowerCase() === SPECIFICATION_MARKER
    );
    const descriptionLines = markerIndex === -1 ? lines : lines.slice(0, markerIndex);
    const specificationLines = markerIndex === -1 ? [] : lines.slice(markerIndex + 1);

    const groups = [];
    let current = null;
    specificationLines.filter(Boolean).forEach((line) => {
        const separator = line.indexOf(":");
        const label = separator === -1 ? "" : line.slice(0, separator).trim();
        const value = separator === -1 ? "" : line.slice(separator + 1).trim();
        if (label && value) {
            if (!current) {
                current = { title: "", rows: [] };
                groups.push(current);
            }
            current.rows.push({ label, value });
            return;
        }
        // Dòng không có dấu ":" (hoặc "Nhãn:" để trống) mở một nhóm mới.
        const title = (separator === -1 ? line : label).trim();
        if (!title) return;
        current = { title, rows: [] };
        groups.push(current);
    });

    return {
        paragraphs: descriptionLines.filter(Boolean),
        groups: groups.filter((group) => group.rows.length > 0)
    };
};

const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

const createDescriptionSection = (paragraphs) => {
    if (!paragraphs.length) return null;
    const section = createElement("section", "product-info__section product-info__description");
    const title = createElement("h2", "product-info__section-title", "Mô tả sản phẩm");
    title.id = "product-info-description-title";
    section.setAttribute("aria-labelledby", title.id);
    section.append(title);
    paragraphs.forEach((paragraph) => section.append(createElement("p", "product-info__description-text", paragraph)));
    return section;
};

const createSpecificationSection = (groups) => {
    if (!groups.length) return null;
    const section = createElement("section", "product-info__section product-info__specifications");
    const title = createElement("h2", "product-info__section-title", "Thông số kỹ thuật");
    title.id = "product-info-specifications-title";
    section.setAttribute("aria-labelledby", title.id);

    const table = createElement("table", "product-info__specifications-table");
    groups.forEach((group) => {
        const body = createElement("tbody");
        if (group.title) {
            const heading = createElement("th", "", group.title);
            heading.colSpan = 2;
            heading.scope = "rowgroup";
            const headingRow = createElement("tr", "product-info__spec-group");
            headingRow.append(heading);
            body.append(headingRow);
        }
        group.rows.forEach((row, index) => {
            const label = createElement("th", "", row.label);
            label.scope = "row";
            const tableRow = createElement("tr", index % 2 ? "product-info__spec-row--alt" : "");
            tableRow.append(label, createElement("td", "", row.value));
            body.append(tableRow);
        });
        table.append(body);
    });
    const wrapper = createElement("div", "product-info__specifications-table-wrapper");
    wrapper.append(table);
    section.append(title, wrapper);
    return section;
};

const createStockInfo = (stock) => {
    if (stock <= 0) {
        return `<div class="product-info__stock product-info__stock--out">
            <span class="product-info__stock-dot product-info__stock-dot--low"></span>
            Hết hàng
        </div>`;
    }
    const dotClass = stock <= 5 ? "product-info__stock-dot--low" : "";
    const text = stock <= 5 ? `Chỉ còn ${stock} sản phẩm` : `Còn ${stock} sản phẩm`;
    return `<div class="product-info__stock">
        <span class="product-info__stock-dot ${dotClass}"></span>
        ${text}
    </div>`;
};

const loadProductInfo = async () => {
    const id = getUrlParam("id");
    const container = document.getElementById("product-info");
    if (!id) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Không có ID sản phẩm trong URL</p>
                <a href="/" class="btn btn--primary" style="margin-top:16px;display:inline-block;">Quay lại trang chủ</a>
            </div>`;
        return;
    }

    try {
        const res = await fetch(`/api/products/info/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const product = data.data;
        const variants = product.variants || [];
        let selectedVariant = variants.find((variant) => variant.stock > 0) || variants[0] || null;
        const authState = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        const canPurchase = authState.user?.role !== "admin";
        const { paragraphs, groups } = parseProductDescription(product.description);
        const variantImage = (variant) => variant?.image || product.image || "";
        const galleryImages = [];
        variants.forEach((variant) => {
            const url = variantImage(variant);
            if (!url) return;
            const entry = galleryImages.find((item) => item.url === url);
            if (entry) entry.variants.push(variant);
            else galleryImages.push({ url, variants: [variant] });
        });
        // Tuỳ chọn nào làm đổi ảnh (màu sắc, tản nhiệt…) thì mới đưa vào alt và nhãn ảnh nhỏ.
        const imageOptionNames = (product.options || []).map((option) => option.name).filter((name) => {
            const imagesByValue = new Map();
            variants.forEach((variant) => {
                const value = variant.optionValues?.[name];
                if (value === undefined) return;
                if (!imagesByValue.has(value)) imagesByValue.set(value, new Set());
                imagesByValue.get(value).add(variantImage(variant));
            });
            return new Set(Array.from(imagesByValue.values(), (images) => Array.from(images).sort().join("|"))).size > 1;
        });
        const describeImage = (variantList) => imageOptionNames
            .map((name) => Array.from(new Set(variantList.map((variant) => variant.optionValues?.[name]).filter(Boolean))).join(" / "))
            .filter(Boolean)
            .join(" · ");
        const galleryThumbs = galleryImages.length >= 2
            ? `<div class="product-info__thumbs" role="group" aria-label="Ảnh theo phiên bản">${galleryImages.map((item, index) => {
                const label = describeImage(item.variants);
                return `<button type="button" class="product-info__thumb" data-gallery-index="${index}" aria-pressed="false" aria-label="${escapeHtml(label ? `Xem ảnh ${label}` : `Xem ảnh ${index + 1}`)}" title="${escapeHtml(label)}">
                    <img src="${escapeHtml(item.url)}" alt="" width="64" height="64" loading="lazy" decoding="async">
                </button>`;
            }).join("")}</div>`
            : "";
        const normalizeOptionName = (name) => String(name ?? "").trim().toLowerCase();
        const optionControls = (product.options || []).map((option) => {
            const isColor = normalizeOptionName(option.name) === "màu sắc";
            const buttons = (option.values || []).map((value) => {
                const isSelected = selectedVariant?.optionValues?.[option.name] === value.value;
                if (isColor) {
                    const hasHex = Boolean(value.colorHex);
                    const dot = hasHex
                        ? `<span class="product-info__swatch-dot" style="background-color:${escapeHtml(value.colorHex)}"></span>`
                        : "";
                    return `<button type="button" class="product-info__swatch${hasHex ? "" : " product-info__swatch--outline"}" data-option-name="${escapeHtml(option.name)}" data-option-value="${escapeHtml(value.value)}" aria-pressed="${isSelected}" title="${escapeHtml(value.value)}">
                        ${dot}<span class="product-info__swatch-label">${escapeHtml(value.value)}</span>
                    </button>`;
                }
                return `<button type="button" class="product-info__chip" data-option-name="${escapeHtml(option.name)}" data-option-value="${escapeHtml(value.value)}" aria-pressed="${isSelected}">${escapeHtml(value.value)}</button>`;
            }).join("");
            return `<div class="product-info__option">
                <span class="product-info__option-label">${escapeHtml(option.name)}</span>
                <div class="product-info__option-values" role="group" aria-label="${escapeHtml(option.name)}">${buttons}</div>
            </div>`;
        }).join("");

        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="product-info__card">
                <div class="product-info__gallery">
                    <div class="product-info__media" id="product-info-media">
                        <img src="${escapeHtml(variantImage(selectedVariant))}" alt="${escapeHtml(product.name)}" class="product-info__image" id="product-info-image" loading="eager" fetchpriority="high" decoding="async">
                    </div>
                    ${galleryThumbs}
                </div>
                <div class="product-info__content">
                    <h1 class="product-info__name">${escapeHtml(product.name)}</h1>
                    <a href="#danh-gia" class="product-info__rating" id="product-rating-link" ${Number(product.ratingCount) > 0 ? "" : "hidden"}>${Number(product.ratingCount) > 0 ? `${CatalogRenderer.renderStars(product.ratingAverage)}<span>${CatalogRenderer.formatRating(product.ratingAverage)} · ${Number(product.ratingCount).toLocaleString("vi-VN")} đánh giá</span>` : ""}</a>
                    <div class="product-info__price" id="variant-price">${selectedVariant ? formatPrice(selectedVariant.price) : "Tạm hết hàng"}</div>
                    ${optionControls ? `<div class="product-info__options" aria-label="Chọn phiên bản">${optionControls}</div>` : ""}
                    <div class="product-info__sku">SKU: <strong id="variant-sku">${escapeHtml(selectedVariant?.sku || "—")}</strong></div>
                    <div id="variant-stock">${createStockInfo(selectedVariant?.stock || 0)}</div>
                    <div class="product-info__actions">
                        ${!canPurchase
                            ? `<span class="product-card__role-note">Tài khoản Admin chỉ xem catalog.</span>`
                            : `<a href="#" class="btn btn--primary" id="buy-now-link" ${selectedVariant?.stock > 0 ? "" : "aria-disabled=\"true\""}>Mua ngay</a>
                               <button class="btn btn--secondary btn--add-cart" id="btn-add-cart" type="button" ${selectedVariant?.stock > 0 ? "" : "disabled"}>
                                   Thêm vào giỏ
                               </button>`
                        }
                    </div>
                </div>
            </div>`;
        [createDescriptionSection(paragraphs), createSpecificationSection(groups)]
            .filter(Boolean)
            .forEach((section) => container.append(section));
        try { ProductReviews.mount({ container, product }); } catch (error) { console.error("Không dựng được khối đánh giá", error); }

        const media = container.querySelector("#product-info-media");
        const mainImage = container.querySelector("#product-info-image");
        const thumbButtons = Array.from(container.querySelectorAll(".product-info__thumb"));
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let imageToken = 0;
        let lastChoice = null;

        // Ảnh chính luôn theo phiên bản đang chọn (hoặc ảnh sản phẩm); đổi ảnh bằng hiệu ứng mờ dần.
        const syncGallery = () => {
            const shown = selectedVariant
                || (lastChoice && variants.find((variant) => variant.optionValues?.[lastChoice.name] === lastChoice.value))
                || null;
            const url = variantImage(shown);
            const detail = describeImage(shown ? [shown] : []);
            mainImage.alt = detail ? `${product.name} – ${detail}` : product.name;
            media.classList.toggle("is-empty", !url);
            if (url && mainImage.getAttribute("src") !== url) {
                const token = ++imageToken;
                const preload = new Image();
                preload.src = url;
                media.classList.add("is-changing");
                const settled = Promise.all([
                    preload.decode ? preload.decode().catch(() => {}) : Promise.resolve(),
                    new Promise((resolve) => setTimeout(resolve, prefersReducedMotion.matches ? 0 : 140))
                ]);
                settled.then(() => {
                    if (token !== imageToken) return;
                    mainImage.src = url;
                    media.classList.remove("is-changing");
                });
            }
            thumbButtons.forEach((button) => {
                const active = galleryImages[Number(button.dataset.galleryIndex)].url === url;
                button.setAttribute("aria-pressed", String(active));
                if (active) {
                    const strip = button.parentElement;
                    const offset = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2;
                    strip.scrollTo({ left: Math.max(0, offset), behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
                }
            });
        };

        const readSelectedOptions = () => Object.fromEntries(
            Array.from(container.querySelectorAll('[data-option-name][aria-pressed="true"]'))
                .map((button) => [button.dataset.optionName, button.dataset.optionValue])
        );

        const updateSelectedVariant = () => {
            const selectedOptions = readSelectedOptions();
            const matches = variants.filter((variant) =>
                Object.entries(selectedOptions).every(([name, value]) => variant.optionValues?.[name] === value)
            );
            selectedVariant = matches.length === 1 ? matches[0] : null;
            const price = container.querySelector("#variant-price");
            const sku = container.querySelector("#variant-sku");
            const stock = container.querySelector("#variant-stock");
            const buyNow = container.querySelector("#buy-now-link");
            const addToCart = container.querySelector("#btn-add-cart");
            price.textContent = selectedVariant ? formatPrice(selectedVariant.price) : "Tổ hợp này không được bán";
            sku.textContent = selectedVariant?.sku || "—";
            stock.innerHTML = selectedVariant
                ? createStockInfo(selectedVariant.stock)
                : `<div class="product-info__stock product-info__stock--out">Không có phiên bản này</div>`;
            const available = Boolean(selectedVariant && selectedVariant.stock > 0);
            if (buyNow) {
                buyNow.href = available ? `/checkouts.html?id=${encodeURIComponent(product.id)}&variantId=${encodeURIComponent(selectedVariant.id)}` : "#";
                buyNow.setAttribute("aria-disabled", String(!available));
                buyNow.classList.toggle("is-disabled", !available);
            }
            if (addToCart) addToCart.disabled = !available;
            syncGallery();
        };

        thumbButtons.forEach((thumb) => thumb.addEventListener("click", () => {
            const group = galleryImages[Number(thumb.dataset.galleryIndex)].variants;
            const current = readSelectedOptions();
            const score = (variant) => Object.entries(current).filter(([name, value]) => variant.optionValues?.[name] === value).length;
            const target = group.reduce((best, variant) => {
                const diff = score(variant) - score(best);
                return diff > 0 || (diff === 0 && variant.stock > 0 && best.stock <= 0) ? variant : best;
            });
            lastChoice = null;
            container.querySelectorAll(".product-info__option [data-option-name]").forEach((button) => {
                const value = target.optionValues?.[button.dataset.optionName];
                if (value !== undefined) button.setAttribute("aria-pressed", String(button.dataset.optionValue === value));
            });
            updateSelectedVariant();
        }));

        container.querySelectorAll(".product-info__option [data-option-name]").forEach((button) =>
            button.addEventListener("click", () => {
                const optionName = button.dataset.optionName;
                const optionValue = button.dataset.optionValue;
                container.querySelectorAll(".product-info__option [data-option-name]").forEach((sibling) => {
                    if (sibling.dataset.optionName === optionName) {
                        sibling.setAttribute("aria-pressed", String(sibling === button));
                    }
                });
                lastChoice = { name: optionName, value: optionValue };
                updateSelectedVariant();
            })
        );
        const buyNow = container.querySelector("#buy-now-link");
        updateSelectedVariant();
        buyNow?.addEventListener("click", (event) => {
            if (!selectedVariant || selectedVariant.stock <= 0) event.preventDefault();
        });
        container.querySelector("#btn-add-cart")?.addEventListener("click", () => {
            if (!selectedVariant || selectedVariant.stock <= 0) return;
            const result = CartService.addItem({
                variantId: selectedVariant.id,
                productId: product.id,
                name: product.name,
                variantLabel: Object.entries(selectedVariant.optionValues || {}).map(([name, value]) => `${name}: ${value}`).join(" · "),
                optionValues: selectedVariant.optionValues || {},
                sku: selectedVariant.sku,
                slug: product.slug,
                price: selectedVariant.price,
                stock: selectedVariant.stock,
                image: selectedVariant.image || product.image,
                description: product.description
            });
            if (!result.ok) {
                showToast(result.message || "Phiên bản đã hết hàng!", "error");
                return;
            }
            if (result.promise) result.promise.catch(() => {});
            showToast(`Đã thêm "${product.name}" vào giỏ hàng`, "success");
        });
    } catch (error) {
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
    }
};

document.addEventListener("DOMContentLoaded", loadProductInfo);
