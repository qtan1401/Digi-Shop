// ===== ORDER REPOSITORY =====
// Prisma persistence only; checkout sequencing remains in the checkout service.

const { getPrismaClient } = require("../db/prisma");

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const toDate = (value) =>
    value === undefined || value === null || value instanceof Date
        ? value
        : new Date(value);

const toNumber = (value) =>
    value === undefined || value === null ? value : Number(value);

const parseOptions = (value) => {
    if (value && typeof value === "object") return value;
    try {
        return JSON.parse(value || "{}");
    } catch {
        return {};
    }
};

const mapOrderItem = (row) => ({
    variantId: toNumber(row.variantId),
    sku: row.skuSnapshot,
    options: parseOptions(row.optionsSnapshot),
    name: row.nameSnapshot,
    image: row.imageSnapshot,
    unitPrice: toNumber(row.unitPrice),
    quantity: row.quantity,
    lineTotal: toNumber(row.lineTotal)
});


const mapOrder = (row, { includeUserId = false } = {}) => {
    if (!row) return undefined;

    const order = {
        id: row.id,
        items: (row.items || []).map(mapOrderItem),
        subtotal: toNumber(row.subtotal),
        shippingFee: toNumber(row.shippingFee),
        discount: toNumber(row.discount),
        totalPrice: toNumber(row.totalPrice),
        customer: {
            name: row.customerName,
            phone: row.customerPhone,
            address: row.customerAddress,
            note: row.customerNote
        },
        paymentMethod: row.paymentMethod,
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt)
    };
    if (includeUserId) order.userId = row.userId;
    return order;
};

const itemsInclude = {
    items: {
        orderBy: { id: "asc" }
    }
};

const createOrder = async (orderData) => {
    const customer = orderData.customer || {};
    const data = {
        id: String(orderData.id),
        subtotal: orderData.subtotal,
        shippingFee: orderData.shippingFee,
        discount: orderData.discount,
        totalPrice: orderData.totalPrice,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        customerNote: customer.note,
        paymentMethod: orderData.paymentMethod,
        orderStatus: orderData.orderStatus,
        paymentStatus: orderData.paymentStatus,
        items: {
            create: (orderData.items || []).map((item) => ({
                variantId: item.variantId,
                nameSnapshot: item.name,
                imageSnapshot: item.image,
                skuSnapshot: item.sku,
                optionsSnapshot: JSON.stringify(item.options || {}),
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                lineTotal: item.lineTotal
            }))
        }
    };
    if (orderData.createdAt !== undefined) data.createdAt = toDate(orderData.createdAt);
    if (orderData.updatedAt !== undefined) data.updatedAt = toDate(orderData.updatedAt);

    const row = await getPrismaClient().order.create({
        data,
        include: itemsInclude
    });
    return mapOrder(row);
};

const getAllOrders = async () => {
    const rows = await getPrismaClient().order.findMany({
        include: itemsInclude,
        orderBy: [
            { createdAt: "desc" },
            { id: "desc" }
        ]
    });
    return rows.map(mapOrder);
};

const getOrderById = async (id, options = {}) => {
    if (id === undefined || id === null) return undefined;

    const row = await getPrismaClient().order.findUnique({
        where: { id: String(id) },
        include: itemsInclude
    });
    return mapOrder(row, options);
};

const updateStatus = async (id, data) => {
    if (id === undefined || id === null) return null;

    const orderId = String(id);
    const prisma = getPrismaClient();
    const result = await prisma.order.updateMany({
        where: { id: orderId },
        data
    });
    if (result.count === 0) return null;

    const row = await prisma.order.findUnique({
        where: { id: orderId },
        include: itemsInclude
    });
    return mapOrder(row);
};

const updateOrderStatus = async (id, status) =>
    updateStatus(id, { orderStatus: status });

const updatePaymentStatus = async (id, status) =>
    updateStatus(id, { paymentStatus: status });

module.exports = {
    createOrder,
    getAllOrders,
    getOrderById,
    updateOrderStatus,
    updatePaymentStatus
};
