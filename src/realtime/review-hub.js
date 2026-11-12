// ===== REVIEW HUB =====
// Realtime fan-out of Product review changes over WebSocket (package `ws`), one room per Product.
// Single-process only: rooms live in memory, so a second app instance would not see this
// instance's events (see docs/adr/0001-review-realtime.md).
// Clients only listen. The payload is exactly what GET /api/products/:id/reviews already returns publicly.

const { WebSocketServer } = require("ws");
const { readAuthConfig } = require("../auth/config");

const WS_PATH = "/ws/reviews";
const MAX_INT32 = 2147483647;
const MAX_CLIENT_FRAME_BYTES = 256; // clients never need to send anything
const MAX_CLIENT_MESSAGES = 10;
const MAX_CONNECTIONS_PER_IP = 20;
const MAX_CONNECTIONS_TOTAL = 5000;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30 * 1000;
const EVENT_TYPES = Object.freeze(["review.created", "review.updated", "review.deleted", "review.hidden"]);

const reject = (socket, status, reason) => {
    if (socket.writable) {
        socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    socket.destroy();
};

/** Client address; honours TRUST_PROXY (hop count) the same way Express does for req.ip. */
const clientAddress = (req) => {
    const hops = /^[1-9]\d*$/.test(process.env.TRUST_PROXY || "") ? Number(process.env.TRUST_PROXY) : 0;
    if (hops > 0 && typeof req.headers["x-forwarded-for"] === "string") {
        const chain = req.headers["x-forwarded-for"].split(",").map((part) => part.trim()).filter(Boolean);
        const forwarded = chain[chain.length - hops];
        if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress || "unknown";
};

const createReviewHub = () => {
    const rooms = new Map(); // productId -> Set<WebSocket>
    const perIp = new Map(); // address -> open connections
    let total = 0;
    let wss = null;
    let heartbeat = null;
    let detach = null;

    const join = (productId, ws) => {
        let room = rooms.get(productId);
        if (!room) rooms.set(productId, room = new Set());
        room.add(ws);
    };

    const leave = (productId, ws) => {
        const room = rooms.get(productId);
        if (!room) return;
        room.delete(ws);
        if (room.size === 0) rooms.delete(productId);
    };

    const track = (address, delta) => {
        const next = (perIp.get(address) || 0) + delta;
        if (next <= 0) perIp.delete(address); else perIp.set(address, next);
    };

    const onConnection = (ws, { productId, address }) => {
        ws.isAlive = true;
        total += 1;
        track(address, 1);
        join(productId, ws);
        let received = 0;
        ws.on("pong", () => { ws.isAlive = true; });
        // Nothing is read from clients; a chatty one is dropped.
        ws.on("message", () => {
            received += 1;
            if (received > MAX_CLIENT_MESSAGES) ws.close(1008, "Policy violation");
        });
        ws.on("error", () => ws.terminate());
        ws.on("close", () => {
            total -= 1;
            track(address, -1);
            leave(productId, ws);
        });
    };

    const handleUpgrade = (req, socket, head) => {
        let url;
        try {
            url = new URL(req.url, "http://localhost");
        } catch {
            return reject(socket, 400, "Bad Request");
        }
        if (url.pathname !== WS_PATH) return reject(socket, 404, "Not Found");

        let origins;
        try {
            origins = readAuthConfig().appOrigins;
        } catch {
            return reject(socket, 500, "Internal Server Error");
        }
        if (typeof req.headers.origin !== "string" || !origins.includes(req.headers.origin)) {
            return reject(socket, 403, "Forbidden");
        }

        const rawId = url.searchParams.get("productId");
        const productId = /^[1-9]\d{0,9}$/.test(rawId || "") ? Number(rawId) : 0;
        if (!productId || productId > MAX_INT32) return reject(socket, 400, "Bad Request");

        const address = clientAddress(req);
        if (total >= MAX_CONNECTIONS_TOTAL || (perIp.get(address) || 0) >= MAX_CONNECTIONS_PER_IP) {
            return reject(socket, 429, "Too Many Requests");
        }

        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, { productId, address }));
    };

    /** Subscribe this hub to a Node http.Server's upgrade events. Returns an async function that undoes it. */
    const attach = (server) => {
        if (wss) throw new Error("Review hub is already attached");
        wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES, perMessageDeflate: false });
        server.on("upgrade", handleUpgrade);
        heartbeat = setInterval(() => {
            for (const room of rooms.values()) {
                for (const ws of room) {
                    if (!ws.isAlive) { ws.terminate(); continue; }
                    ws.isAlive = false;
                    ws.ping();
                }
            }
        }, HEARTBEAT_MS);
        heartbeat.unref();

        detach = async () => {
            server.removeListener("upgrade", handleUpgrade);
            clearInterval(heartbeat);
            const closing = wss;
            wss = null;
            detach = null;
            for (const room of rooms.values()) {
                for (const ws of room) ws.terminate();
            }
            await new Promise((resolve) => closing.close(resolve));
        };
        return detach;
    };

    const hasSubscribers = (productId) => rooms.has(productId);

    /** Sends one event to everyone watching the Product. `review` and `aggregate` are public data only. */
    const publish = (productId, { type, review, aggregate }) => {
        if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown review event type: ${type}`);
        const room = rooms.get(productId);
        if (!room) return 0;
        const message = JSON.stringify({ type, review, aggregate });
        let sent = 0;
        for (const ws of room) {
            if (ws.readyState !== ws.OPEN) continue;
            if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { ws.terminate(); continue; }
            ws.send(message);
            sent += 1;
        }
        return sent;
    };

    const stats = () => ({ connections: total, rooms: rooms.size });

    return { WS_PATH, EVENT_TYPES, attach, publish, hasSubscribers, stats, close: async () => { if (detach) await detach(); } };
};

module.exports = createReviewHub();
module.exports.createReviewHub = createReviewHub;
