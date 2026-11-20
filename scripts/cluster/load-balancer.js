const http = require("node:http");
const net = require("node:net");

const HEALTH_INTERVAL_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;
const PORT = 8080;
const backends = [3101, 3102, 3103].map((port) => ({ port, healthy: false, lastHealthyAt: 0 }));
let nextIndex = 0;
let checking = false;
let shuttingDown = false;

const forwardedHeaders = (req) => ({
    ...req.headers,
    "x-forwarded-for": req.socket.remoteAddress || "unknown",
    "x-forwarded-proto": req.socket.encrypted ? "https" : "http",
    "x-forwarded-host": req.headers.host || ""
});

const activeBackends = () => {
    const now = Date.now();
    return backends.filter((backend) => backend.healthy && now - backend.lastHealthyAt <= HEALTH_INTERVAL_MS);
};

const nextBackend = () => {
    const available = activeBackends();
    if (available.length === 0) return null;
    const backend = available[nextIndex % available.length];
    nextIndex += 1;
    return backend;
};

const refreshHealth = async () => {
    if (checking) return;
    checking = true;
    try {
        await Promise.all(backends.map(async (backend) => {
            const wasHealthy = backend.healthy;
            try {
                const response = await fetch(`http://127.0.0.1:${backend.port}/healthz`, {
                    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
                });
                await response.arrayBuffer();
                backend.healthy = response.status === 200;
                if (backend.healthy) backend.lastHealthyAt = Date.now();
            } catch {
                backend.healthy = false;
            }
            if (wasHealthy !== backend.healthy) {
                const status = backend.healthy ? "healthy" : "unhealthy";
                console.log(`[load-balancer] instance ${backend.port} is ${status}`);
            }
        }));
    } finally {
        checking = false;
    }
};

const unavailable = (res, status, message) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close" });
    res.end(message);
};

const server = http.createServer((req, res) => {
    const backend = nextBackend();
    if (!backend) return unavailable(res, 503, "No healthy Digi-Shop instances are available.");

    const upstream = http.request({
        hostname: "127.0.0.1",
        port: backend.port,
        method: req.method,
        path: req.url,
        headers: forwardedHeaders(req)
    }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
    });
    upstream.on("error", () => {
        if (res.headersSent) return res.destroy();
        unavailable(res, 502, "The selected Digi-Shop instance is unavailable.");
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
    const backend = nextBackend();
    if (!backend) {
        socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
    }

    const upstream = net.connect(backend.port, "127.0.0.1");
    let connected = false;
    upstream.once("connect", () => {
        connected = true;
        const lines = [`GET ${req.url} HTTP/${req.httpVersion}`];
        for (const [name, value] of Object.entries(forwardedHeaders(req))) {
            if (Array.isArray(value)) {
                for (const item of value) lines.push(`${name}: ${item}`);
            } else if (value !== undefined) {
                lines.push(`${name}: ${value}`);
            }
        }
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on("error", () => {
        if (!connected && socket.writable) {
            socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        } else {
            socket.destroy();
        }
    });
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
});

const sockets = new Set();
server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});

const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(healthTimer);
    if (server.listening) server.close();
    for (const socket of sockets) socket.destroy();
};

const healthTimer = setInterval(() => { void refreshHealth(); }, HEALTH_INTERVAL_MS);
healthTimer.unref();
void refreshHealth();

server.listen(PORT, () => {
    console.log(`[load-balancer] listening on http://localhost:${PORT}`);
});
server.on("error", (error) => {
    console.error(`[load-balancer] server failed (${error.code || error.name || "unknown"})`);
    shutdown();
    process.exitCode = 1;
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
