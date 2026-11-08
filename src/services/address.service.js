const crypto = require("crypto");
const repository = require("../repositories/address.repository");

const MAX_ADDRESSES = 10;
// Same phone rule the checkout enforces (checkout.service validateCustomer).
const PHONE_PATTERN = /^(0|\+84)[0-9]{8,10}$/;

class AddressError extends Error {
    constructor(code, message, statusCode, fields) {
        super(message);
        this.name = "AddressError";
        this.code = code;
        this.statusCode = statusCode;
        if (fields) this.fields = fields;
    }
}

const text = (value) => typeof value === "string" ? value.trim() : "";

// Shared by address CRUD and registration. Returns { value } or { fields } listing what is wrong.
const validateAddressInput = ({ recipientName, phone, addressLine }) => {
    const value = { recipientName: text(recipientName), phone: text(phone), addressLine: text(addressLine) };
    const fields = {};
    if (value.recipientName.length < 2 || value.recipientName.length > 200) fields.recipientName = "Tên người nhận phải có 2-200 ký tự";
    if (!PHONE_PATTERN.test(value.phone)) fields.phone = "Số điện thoại không hợp lệ (VD: 0901234567 hoặc +84901234567)";
    if (value.addressLine.length < 5 || value.addressLine.length > 500) fields.addressLine = "Địa chỉ phải có 5-500 ký tự";
    return Object.keys(fields).length ? { fields } : { value };
};

const assertValid = (input) => {
    const result = validateAddressInput(input || {});
    if (result.fields) throw new AddressError("VALIDATION_FAILED", "Thông tin địa chỉ không hợp lệ", 400, result.fields);
    return result.value;
};

const notFound = () => new AddressError("ADDRESS_NOT_FOUND", "Không tìm thấy địa chỉ", 404);
const view = (row) => row && ({
    id: row.id,
    recipientName: row.recipientName,
    phone: row.phone,
    addressLine: row.addressLine,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
});

const list = async (userId) => (await repository.listByUser(userId)).map(view);

const create = async (userId, input) => {
    const value = assertValid(input);
    const wantsDefault = input?.isDefault === true;
    const created = await repository.withUserLock(userId, async (tx) => {
        const count = await repository.countByUser(userId, tx);
        if (count >= MAX_ADDRESSES) {
            throw new AddressError("ADDRESS_LIMIT_REACHED", `Bạn chỉ có thể lưu tối đa ${MAX_ADDRESSES} địa chỉ`, 409);
        }
        const isDefault = count === 0 || wantsDefault;
        if (isDefault) await repository.clearDefault(userId, tx);
        return repository.create({ id: crypto.randomUUID(), userId, ...value, isDefault, createdAt: new Date() }, tx);
    });
    return view(created);
};

const update = async (userId, id, input) => {
    const value = assertValid(input);
    const updated = await repository.withUserLock(userId, async (tx) => {
        const current = await repository.findOwned(userId, id, tx);
        if (!current) throw notFound();
        const promote = input?.isDefault === true && !current.isDefault;
        if (promote) await repository.clearDefault(userId, tx);
        // isDefault:false is ignored: the only way to stop being the default is to make another address the default.
        await repository.update(userId, id, promote ? { ...value, isDefault: true } : value, tx);
        return repository.findOwned(userId, id, tx);
    });
    return view(updated);
};

const remove = async (userId, id) => {
    await repository.withUserLock(userId, async (tx) => {
        const current = await repository.findOwned(userId, id, tx);
        if (!current) throw notFound();
        await repository.remove(userId, id, tx);
        if (current.isDefault) {
            const next = await repository.findNewestByUser(userId, tx);
            if (next) await repository.update(userId, next.id, { isDefault: true }, tx);
        }
    });
};

const setDefault = async (userId, id) => {
    const updated = await repository.withUserLock(userId, async (tx) => {
        const current = await repository.findOwned(userId, id, tx);
        if (!current) throw notFound();
        if (!current.isDefault) {
            await repository.clearDefault(userId, tx);
            await repository.update(userId, id, { isDefault: true }, tx);
        }
        return repository.findOwned(userId, id, tx);
    });
    return view(updated);
};

module.exports = { AddressError, MAX_ADDRESSES, PHONE_PATTERN, validateAddressInput, list, create, update, remove, setDefault };
