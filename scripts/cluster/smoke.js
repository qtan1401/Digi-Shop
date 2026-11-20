const TARGET = (process.argv[2] || "http://localhost:8080").replace(/\/+$/, "");
const REQUESTS = 30;
const expectedInstances = new Set(["local-1", "local-2", "local-3"]);

const waitForHealthyInstances = async () => {
    const healthy = new Set();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && healthy.size < expectedInstances.size) {
        try {
            const response = await fetch(`${TARGET}/healthz`, { signal: AbortSignal.timeout(1000) });
            const instance = response.headers.get("x-instance");
            if (response.ok && expectedInstances.has(instance)) healthy.add(instance);
            await response.arrayBuffer();
        } catch (_) {}
        if (healthy.size < expectedInstances.size) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    if (healthy.size === expectedInstances.size) return true;
    const missing = [...expectedInstances].filter((instance) => !healthy.has(instance));
    console.error(`[cluster:smoke] instances not healthy within 10 seconds: ${missing.join(", ")}`);
    return false;
};

const main = async () => {
    const counts = new Map();
    let failures = 0;
    console.log("[cluster:smoke] waiting for all three instances to become healthy");
    if (!(await waitForHealthyInstances())) {
        process.exitCode = 1;
        return;
    }

    for (let index = 0; index < REQUESTS; index += 1) {
        try {
            const response = await fetch(`${TARGET}/healthz`, { signal: AbortSignal.timeout(5000) });
            const instance = response.headers.get("x-instance") || "(missing X-Instance)";
            counts.set(instance, (counts.get(instance) || 0) + 1);
            if (!response.ok) failures += 1;
            await response.arrayBuffer();
        } catch (error) {
            failures += 1;
            const reason = error?.name === "TimeoutError" ? "request timed out" : "request failed";
            console.error(`[cluster:smoke] request ${index + 1} ${reason}`);
        }
    }

    console.log(`\n${REQUESTS} requests to ${TARGET}/healthz`);
    console.table([...counts].map(([instance, requests]) => ({ instance, requests })));
    if (failures > 0) {
        console.error(`[cluster:smoke] ${failures} request(s) failed`);
        process.exitCode = 1;
    }
    for (const instance of expectedInstances) {
        if (!counts.has(instance)) {
            console.error(`[cluster:smoke] no request reached ${instance}`);
            process.exitCode = 1;
        }
    }
};

void main();
