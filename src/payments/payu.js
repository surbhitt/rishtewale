// PayU SDK singleton. payu-websdk is CommonJS (default export is the Payu class); Node's ESM
// interop exposes it as the default import. We construct exactly one instance and reuse it, since
// it is stateless apart from the credentials it holds.
import Payu from "payu-websdk";

import config from "../config/index.js";

let instance = null;

function assertConfigured() {
    const { key, salt, env } = config.payu;
    const missing = [];
    if (!key) missing.push("PAYU_KEY");
    if (!salt) missing.push("PAYU_SALT");

    if (missing.length > 0) {
        throw new Error(
            `PayU is not configured: missing ${missing.join(", ")}. Set them in the environment to use payment routes.`
        );
    }

    if (env !== "TEST" && env !== "PROD") {
        throw new Error(`Invalid PAYU_ENV "${env}": expected TEST or PROD.`);
    }
}

// Lazily build the singleton on first use so the rest of the app can boot without PayU credentials.
export function getPayu() {
    if (instance) {
        return instance;
    }

    assertConfigured();

    const { key, salt, env } = config.payu;
    instance = new Payu({ key, salt }, env);

    console.log(`PayU initialized (env=${env})`);
    return instance;
}

// True when PayU credentials are present, without throwing. Useful for a health/feature check.
export function isPayuConfigured() {
    return Boolean(config.payu.key && config.payu.salt);
}

export default getPayu;
