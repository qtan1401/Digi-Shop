const DEFAULT_REQUESTS = 30;
const REQUEST_TIMEOUT_MS = 10000;

const usage = () => {
    console.error("Usage: npm run cloud:smoke -- <url> [count]");
    console.error(`count defaults to ${DEFAULT_REQUESTS} concurrent /healthz requests`);
};

const parseArguments = () => {
    const rawUrl = process.argv[2];
    const rawCount = process.argv[3];
    if (!rawUrl) {
        usage();
        return null;
    }

    let url;
    try {
        url = new URL(rawUrl);
    } catch (_) {
        console.error("[cloud:smoke] invalid URL");
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        console.error("[cloud:smoke] URL must use http or https");
        return null;
    }
    if (url.username || url.password || url.search || url.hash) {
        console.error("[cloud:smoke] URL must not contain credentials, query parameters, or a fragment");
        return null;
    }

    let count = DEFAULT_REQUESTS;
    if (rawCount !== undefined) {
        if (!/^\d+$/.test(rawCount) || Number(rawCount) < 1 || !Number.isSafeInteger(Number(rawCount))) {
            console.error("[cloud:smoke] count must be a positive safe integer");
            return null;
        }
        count = Number(rawCount);
    }

    url.pathname = `${url.pathname.replace(/\/+$/, "")}/healthz`;
    return { target: url.toString(), count };
};

const main = async () => {
    const args = parseArguments();
    if (!args) {
        process.exitCode = 1;
        return;
    }

    const counts = new Map();
    let failures = 0;
    const requests = Array.from({ length: args.count }, async (_, index) => {
        try {
            const response = await fetch(args.target, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const instance = response.headers.get("x-instance");
            if (instance) counts.set(instance, (counts.get(instance) || 0) + 1);
            else {
                counts.set("(missing X-Instance)", (counts.get("(missing X-Instance)") || 0) + 1);
                failures += 1;
                console.error(`[cloud:smoke] request ${index + 1}: missing X-Instance header`);
            }
            if (!response.ok) {
                failures += 1;
                console.error(`[cloud:smoke] request ${index + 1}: HTTP ${response.status}`);
            }
            await response.body?.cancel();
        } catch (error) {
            failures += 1;
            const reason = error?.name === "TimeoutError" ? "timed out" : "failed";
            console.error(`[cloud:smoke] request ${index + 1}: ${reason}`);
        }
    });
    await Promise.all(requests);

    console.log(`\n${args.count} concurrent requests to ${args.target}`);
    console.table([...counts].map(([instance, requests]) => ({ instance, requests })));
    if (failures > 0) {
        console.error(`[cloud:smoke] ${failures} request(s) failed`);
        process.exitCode = 1;
    }
};

void main();
