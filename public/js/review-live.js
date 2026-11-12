// ===== REVIEW-LIVE.JS =====
// Realtime cho khối đánh giá: nối websocket /ws/reviews?productId=, tự nối lại có backoff,
// và khi mất kết nối thì làm mới (poll) mỗi 30 giây. Chỉ nhận dữ liệu công khai mà API danh sách đã trả.
//
//   const live = ReviewLive.connect({ productId, onEvent, onResync, onStatus });
//   onEvent({ type, review, aggregate })   mỗi sự kiện review.created|updated|deleted|hidden hợp lệ
//   onResync()                             cần tải lại danh sách (poll, hoặc vừa nối lại sau khi mất kết nối)
//   onStatus("live" | "poll")              đang nhận trực tiếp hay đang làm mới định kỳ
//   live.close()

(function () {
    "use strict";
    const POLL_MS = 30000;
    const BACKOFF_MIN_MS = 1000;
    const BACKOFF_MAX_MS = 30000;
    const MAX_MESSAGE_CHARS = 20000;
    const EVENT_TYPES = new Set(["review.created", "review.updated", "review.deleted", "review.hidden"]);

    const parseEvent = (raw) => {
        if (typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) return null;
        let event;
        try { event = JSON.parse(raw); } catch (_) { return null; }
        if (!event || typeof event !== "object" || !EVENT_TYPES.has(event.type)) return null;
        if (!event.review || typeof event.review !== "object" || !Number.isInteger(event.review.id)) return null;
        return event;
    };

    const connect = ({ productId, onEvent, onResync, onStatus }) => {
        const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/reviews?productId=${encodeURIComponent(productId)}`;
        let socket = null;
        let closed = false;
        let attempts = 0;
        let hasDropped = false;
        let reconnectTimer = null;
        let pollTimer = null;
        let status = "";

        const setStatus = (next) => {
            if (next === status) return;
            status = next;
            if (typeof onStatus === "function") onStatus(next);
        };

        const startPolling = () => {
            if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden && typeof onResync === "function") onResync(); }, POLL_MS);
            setStatus("poll");
        };

        const stopPolling = () => {
            clearInterval(pollTimer);
            pollTimer = null;
        };

        const scheduleReconnect = () => {
            if (closed || reconnectTimer) return;
            const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempts);
            attempts += 1;
            reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, ceiling * (0.5 + Math.random() / 2));
        };

        const open = () => {
            if (closed) return;
            if (typeof WebSocket !== "function") { startPolling(); return; }
            let ws;
            try { ws = new WebSocket(url); } catch (_) { startPolling(); scheduleReconnect(); return; }
            socket = ws;
            ws.addEventListener("open", () => {
                attempts = 0;
                stopPolling();
                setStatus("live");
                // Events sent while the socket was down are gone: reload once.
                if (hasDropped && typeof onResync === "function") onResync();
            });
            ws.addEventListener("message", (message) => {
                const event = parseEvent(message.data);
                if (event && typeof onEvent === "function") onEvent(event);
            });
            ws.addEventListener("close", () => {
                if (socket === ws) socket = null;
                if (closed) return;
                hasDropped = true;
                startPolling();
                scheduleReconnect();
            });
            // "error" is always followed by "close", which handles the retry.
        };

        const onVisible = () => {
            if (document.hidden || closed || socket || !reconnectTimer) return;
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
            open();
        };
        document.addEventListener("visibilitychange", onVisible);

        open();

        return {
            close() {
                closed = true;
                clearTimeout(reconnectTimer);
                stopPolling();
                document.removeEventListener("visibilitychange", onVisible);
                if (socket) socket.close();
            }
        };
    };

    window.ReviewLive = Object.freeze({ connect, parseEvent });
})();
