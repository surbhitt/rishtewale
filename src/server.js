import config from "./config/index.js";
import createApp from "./app.js";
import pool from "./db/index.js";
import initializeDatabase from "./db/init.js";

async function start() {
    // Ensure the schema exists / is migrated before accepting traffic.
    await initializeDatabase();

    const app = createApp();

    const server = app.listen(config.port, () => {
        console.log(`Started server on port ${config.port} (${config.env})`);
    });

    // Graceful shutdown: stop accepting new connections, finish in-flight requests, close the DB
    // pool, then exit. Force-exit if it takes too long.
    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} received, shutting down gracefully...`);

        const forceExit = setTimeout(() => {
            console.error("Could not close connections in time, forcing exit");
            process.exit(1);
        }, config.shutdownTimeoutMs);
        forceExit.unref();

        server.close(async (err) => {
            if (err) {
                console.error("Error during server close:", err);
            }
            try {
                await pool.end();
                console.log("DB pool closed. Bye.");
                process.exit(err ? 1 : 0);
            } catch (poolErr) {
                console.error("Error closing DB pool:", poolErr);
                process.exit(1);
            }
        });
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Last-resort safety nets: log and exit so the platform can restart a clean process.
    process.on("unhandledRejection", (reason) => {
        console.error("Unhandled promise rejection:", reason);
        shutdown("unhandledRejection");
    });
    process.on("uncaughtException", (err) => {
        console.error("Uncaught exception:", err);
        shutdown("uncaughtException");
    });

    return server;
}

start().catch((err) => {
    console.error("FAILED to start server:", err);
    process.exit(1);
});
