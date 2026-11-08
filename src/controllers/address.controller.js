const service = require("../services/address.service");

const sendError = (res, error) => {
    if (error instanceof service.AddressError) {
        return res.status(error.statusCode).json({
            success: false,
            error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) }
        });
    }
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Request failed" } });
};

const handle = (action, status = 200) => async (req, res) => {
    try {
        const data = await action(req);
        return status === 204 ? res.status(204).send() : res.status(status).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const list = handle(async (req) => ({ addresses: await service.list(req.user.id), limit: service.MAX_ADDRESSES }));
const create = handle(async (req) => ({ address: await service.create(req.user.id, req.body) }), 201);
const update = handle(async (req) => ({ address: await service.update(req.user.id, req.params.id, req.body) }));
const remove = handle(async (req) => service.remove(req.user.id, req.params.id), 204);
const setDefault = handle(async (req) => ({ address: await service.setDefault(req.user.id, req.params.id) }));

module.exports = { list, create, update, remove, setDefault };
