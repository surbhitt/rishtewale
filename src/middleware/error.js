import config from "../config/index.js";

// 404 handler for any route not matched above it.
export function notFound(req, res, next) {
    const msg = `Not found: ${req.method} ${req.originalUrl}`;
    res.status(404).json({ error: msg, message: msg });
}

// Centralized error handler. Express 5 forwards rejected async handlers here automatically.
// Must keep the 4-arg signature so Express recognizes it as an error handler.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;

    // Log the full error server-side; never leak internals to the client in production.
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

    const clientMessage = status >= 500 ? "Internal server error" : err.message;
    // Expose both `error` and `message`: different clients read different keys, and keeping them in
    // sync avoids the class of bug where an API error never surfaces in the UI.
    const body = { error: clientMessage, message: clientMessage };
    if (!config.isProduction && status >= 500) {
        body.detail = err.message;
        body.stack = err.stack;
    }

    res.status(status).json(body);
}
