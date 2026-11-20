const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

const root = path.resolve(__dirname, "../..");
const serverScript = path.join(root, "server.js");
const loadBalancerScript = path.join(__dirname, "load-balancer.js");
const children = [];
let shuttingDown = false;

const startChild = (name, script, env = {}) => {
    const child = spawn(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ["inherit", "pipe", "pipe"]
    });
    children.push(child);
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        const lines = readline.createInterface({ input: stream });
        lines.on("line", (line) => output.write(`[${name}] ${line}\n`));
    }
    child.on("error", (error) => {
        console.error(`[cluster] could not start ${name} (${error.code || error.name || "unknown"})`);
    });
    child.on("close", (code, signal) => {
        if (!shuttingDown) {
            console.error(`[cluster] ${name} exited unexpectedly (code=${code ?? "none"}, signal=${signal || "none"}); remaining processes continue`);
        }
    });
    return child;
};

for (const [index, port] of [3101, 3102, 3103].entries()) {
    const instanceId = `local-${index + 1}`;
    const child = startChild(`app ${instanceId}`, serverScript, {
        PORT: String(port),
        INSTANCE_ID: instanceId,
        RATE_LIMIT_STORE: "database",
        REVIEW_EVENTS_MODE: "database",
        TRUST_PROXY: "1"
    });
    console.log(`[cluster] started ${instanceId} on port ${port} (pid ${child.pid || "pending"})`);
}

const loadBalancer = startChild("load-balancer", loadBalancerScript);
console.log(`[cluster] started load balancer on port 8080 (pid ${loadBalancer.pid || "pending"})`);

const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] stopping all child processes (${signal})`);

    const exited = children.map((child) => new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("close", resolve);
    }));
    for (const child of children) {
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill(signal);
    }

    let timeout;
    await Promise.race([
        Promise.all(exited),
        new Promise((resolve) => { timeout = setTimeout(resolve, 8000); })
    ]);
    clearTimeout(timeout);

    for (const child of children) {
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await Promise.all(exited);
    process.exitCode = 0;
};

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
