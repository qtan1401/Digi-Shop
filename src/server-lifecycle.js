const { DatabaseConfigError } = require("./db/config");
const {
    DatabaseSchemaError,
    connectPrisma,
    disconnectPrisma
} = require("./db/prisma");

const SAFE_CODE = /^[A-Z0-9_-]+$/;

function errorCode(error) {
    const candidates = [
        error && error.code,
        error && error.meta && error.meta.code,
        error && error.cause && error.cause.code
    ];

    for (const candidate of candidates) {
        const code = String(candidate || "").toUpperCase();
        if (SAFE_CODE.test(code)) {
            return code;
        }
    }

    return "UNKNOWN";
}

function errorNumber(error) {
    const candidates = [
        error && error.number,
        error && error.cause && error.cause.number,
        error && error.originalError && error.originalError.info && error.originalError.info.number
    ];
    return candidates.map(Number).find(Number.isFinite);
}

function classifyStartupError(error) {
    const code = errorCode(error);
    const number = errorNumber(error);

    if (error instanceof DatabaseConfigError) {
        return { category: "configuration", code };
    }
    if (error instanceof DatabaseSchemaError || ["P2021", "P2022"].includes(code) || [207, 208].includes(number)) {
        return { category: "schema", code };
    }
    if (code === "P1000" || code === "ELOGIN" || number === 18456) {
        return { category: "authentication", code };
    }
    if (code === "P1010" || [229, 262, 916, 15247].includes(number)) {
        return { category: "permission", code };
    }
    if (["P1001", "P1002", "ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ENOTOPEN"].includes(code)) {
        return { category: "network", code };
    }
    if (["EACCES", "EADDRINUSE"].includes(code)) {
        return { category: "server", code };
    }

    return { category: "database", code };
}

function formatStartupDiagnostic(error) {
    const { category, code } = classifyStartupError(error);
    const codeSuffix = code === "UNKNOWN" ? "" : ` (${code})`;
    const migrationHint = category === "schema" ? " Run `npm run db:migrate` before restarting." : "";
    return `Startup failed [${category}]${codeSuffix}. Server not started.${migrationHint}`;
}

function listen(app, port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            server.removeListener("error", onError);
            resolve(server);
        });
        const onError = (error) => reject(error);
        server.once("error", onError);
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function createShutdown({ server, disconnect = disconnectPrisma, logger = console, processRef = process }) {
    let shutdownPromise;

    return function shutdown(signal) {
        if (shutdownPromise) {
            return shutdownPromise;
        }

        shutdownPromise = (async () => {
            let failure;

            try {
                await closeServer(server);
            } catch (error) {
                failure = error;
            }

            try {
                await disconnect();
            } catch (error) {
                failure ||= error;
            }

            if (failure) {
                const code = errorCode(failure);
                const codeSuffix = code === "UNKNOWN" ? "" : ` (${code})`;
                logger.error(`Shutdown failed${codeSuffix}.`);
                processRef.exitCode = 1;
                return;
            }

            logger.log(`Server stopped after ${signal}.`);
        })();

        return shutdownPromise;
    };
}

async function startServer({
    app,
    port,
    connect = connectPrisma,
    disconnect = disconnectPrisma,
    logger = console,
    processRef = process
}) {
    let server;

    try {
        await connect();
        server = await listen(app, port);
    } catch (error) {
        try {
            await disconnect();
        } catch {
            // Preserve the startup failure and keep its diagnostic redacted.
        }
        throw error;
    }

    const shutdown = createShutdown({ server, disconnect, logger, processRef });
    const removeSignalHandlers = () => {
        processRef.removeListener("SIGINT", signalHandlers.SIGINT);
        processRef.removeListener("SIGTERM", signalHandlers.SIGTERM);
    };
    const handleSignal = (signal) => {
        void shutdown(signal).finally(removeSignalHandlers);
    };
    const signalHandlers = {
        SIGINT: () => handleSignal("SIGINT"),
        SIGTERM: () => handleSignal("SIGTERM")
    };

    processRef.on("SIGINT", signalHandlers.SIGINT);
    processRef.on("SIGTERM", signalHandlers.SIGTERM);
    logger.log(`✅ Server đang chạy tại: http://localhost:${port}`);

    return { server, shutdown };
}

async function runServer(options) {
    const logger = options.logger || console;
    const processRef = options.processRef || process;

    try {
        return await startServer(options);
    } catch (error) {
        logger.error(formatStartupDiagnostic(error));
        processRef.exitCode = 1;
        return null;
    }
}

module.exports = {
    classifyStartupError,
    createShutdown,
    formatStartupDiagnostic,
    runServer,
    startServer
};
