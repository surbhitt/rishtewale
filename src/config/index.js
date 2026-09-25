
import dotenv from "dotenv";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";

// DATABASE_URL is written by `neon link`; DB_URL is the older name still set on Render.
const databaseUrl = process.env.DATABASE_URL || process.env.DB_URL;
const jwtSecret = process.env.JWT_SECRET;

const missing = [];
if (!databaseUrl) missing.push("DATABASE_URL (or DB_URL)");
if (!jwtSecret) missing.push("JWT_SECRET");

if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
}

const config = Object.freeze({
    env: NODE_ENV,
    isProduction: NODE_ENV === "production",
    port: Number(process.env.PORT) || 3000,
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    dbPoolMax: Number(process.env.DB_POOL_MAX) || 5,
    shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000,

    payu: {
        key: process.env.PAYU_KEY,
        salt: process.env.PAYU_SALT,
        env: (process.env.PAYU_ENV || "TEST").toUpperCase(),
        callbackBaseUrl: (process.env.PAYU_CALLBACK_BASE_URL || "").replace(/\/+$/, ""),
        successRedirectUrl: process.env.PAYU_SUCCESS_REDIRECT_URL || "",
        failureRedirectUrl: process.env.PAYU_FAILURE_REDIRECT_URL || ""
    }
});

export default config;
