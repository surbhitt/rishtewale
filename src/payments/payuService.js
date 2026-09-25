import crypto from "node:crypto";

import config from "../config/index.js";
import { isValidEmail } from "../utils/email.js";
import { getPayu } from "./payu.js";
import {
    createPayment,
    updatePaymentStatus,
    getPaymentByTxnid,
    getSuccessfulPaymentByUser
} from "./paymentsRepo.js";

// Guardrails on amount to catch obviously wrong values before they reach PayU.
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1_000_000;

// PayU amounts must be a fixed 2-decimal string; PayU is strict about the exact string used in the
// hash matching what is posted.
function formatAmount(amount) {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
        const err = new Error("A valid payment amount is required");
        err.status = 400;
        throw err;
    }
    if (num < MIN_AMOUNT || num > MAX_AMOUNT) {
        const err = new Error(`Payment amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT}`);
        err.status = 400;
        throw err;
    }
    return num.toFixed(2);
}

function generateTxnid() {
    // Unique, URL-safe, and short enough for PayU's txnid limit.
    return `txn_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function requireCallbackBaseUrl() {
    if (!config.payu.callbackBaseUrl) {
        const err = new Error("PAYU_CALLBACK_BASE_URL is not configured");
        err.status = 500;
        throw err;
    }
    return config.payu.callbackBaseUrl;
}

/**
 * Prepare a PayU payment: persist an "initiated" row and return the full set of parameters
 * (including the server-computed hash) the frontend must POST to PayU's payment URL. Doing the
 * hash on the server keeps the salt secret — never expose the salt to the client.
 */
export async function initiatePayment({ userId, amount, productinfo, firstname, email, phone, udf = {} }) {
    if (!productinfo) {
        const err = new Error("productinfo is required");
        err.status = 400;
        throw err;
    }
    if (!firstname || !firstname.trim()) {
        const err = new Error("firstname is required by PayU");
        err.status = 400;
        throw err;
    }
    if (!email || !isValidEmail(email)) {
        const err = new Error("A valid email is required by PayU");
        err.status = 400;
        throw err;
    }

    // PayU requires a valid mobile number to open checkout.
    const phoneDigits = phone ? String(phone).replace(/[^\d]/g, "") : "";
    if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
        const err = new Error("A valid 10-digit mobile number is required by PayU");
        err.status = 400;
        throw err;
    }

    // Prevent charging a user who has already paid successfully.
    const existingSuccess = await getSuccessfulPaymentByUser(userId);
    if (existingSuccess) {
        const err = new Error("A successful payment already exists for this account");
        err.status = 409;
        throw err;
    }

    const payu = getPayu();
    const base = requireCallbackBaseUrl();
    const txnid = generateTxnid();
    const formattedAmount = formatAmount(amount);

    // PayU rejects some special characters in firstname; keep it to a safe subset.
    const safeFirstname = String(firstname).trim().replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 60) || "Customer";

    const params = {
        txnid,
        amount: formattedAmount,
        productinfo,
        firstname: safeFirstname,
        email: String(email).trim(),
        phone: phoneDigits,
        surl: `${base}/api/payments/success`,
        furl: `${base}/api/payments/failure`,
        udf1: udf.udf1 || "",
        udf2: udf.udf2 || "",
        udf3: udf.udf3 || "",
        udf4: udf.udf4 || "",
        udf5: udf.udf5 || ""
    };

    // Server-side hash over the mandatory PayU field sequence.
    const hash = payu.hasher.generatePaymentHash(params);

    await createPayment({
        txnid,
        userId,
        amount: formattedAmount,
        productinfo,
        firstname: safeFirstname,
        email: params.email,
        phone: params.phone
    });

    return {
        paymentUrl: config.payu.env === "PROD" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment",
        params: { ...params, key: config.payu.key, hash }
    };
}

/**
 * Validate a callback POST from PayU (surl/furl). Verifies the reverse hash against the salt so a
 * forged callback cannot mark a payment as paid. Returns the trusted status string.
 */
export function validateCallback(body) {
    const payu = getPayu();
    const valid = payu.hasher.validateResponseHash(body);
    return { valid, status: body.status };
}

/**
 * Reconcile a callback into our DB after validating its hash. This is the trusted write path.
 */
export async function reconcileCallback(body) {
    const { valid } = validateCallback(body);
    if (!valid) {
        const err = new Error("PayU callback hash validation failed");
        err.status = 400;
        throw err;
    }

    const status = body.status === "success" ? "success" : "failure";
    const updated = await updatePaymentStatus(body.txnid, {
        status,
        mihpayid: body.mihpayid,
        mode: body.mode,
        errorMessage: body.error_Message || body.error || null
    });

    return { status, payment: updated };
}

/**
 * Server-to-server verification with PayU (the authoritative check). Updates our DB to match and
 * returns the merged result. Use this for reconciliation independent of the browser callback.
 */
export async function verifyPayment(txnid) {
    if (!txnid) {
        const err = new Error("txnid is required");
        err.status = 400;
        throw err;
    }

    // The txnid must belong to a transaction we created; otherwise treat it as not found.
    const existing = await getPaymentByTxnid(txnid);
    if (!existing) {
        const err = new Error("Transaction not found");
        err.status = 404;
        throw err;
    }

    const payu = getPayu();

    let response;
    try {
        response = await payu.verifyPayment(txnid);
    } catch (cause) {
        // Network/PayU-side failure during verification — surface as a transient 502 so the client
        // can retry, without losing the fact that our DB row still exists.
        const err = new Error("Could not reach the payment gateway to verify this transaction");
        err.status = 502;
        throw err;
    }

    // PayU returns { status: 1, transaction_details: { <txnid>: { status, mihpayid, mode, ... } } }
    const details = response?.transaction_details?.[txnid];
    if (details) {
        const mapped =
            details.status === "success" ? "success" :
            details.status === "failure" ? "failure" : "pending";
        await updatePaymentStatus(txnid, {
            status: mapped,
            mihpayid: details.mihpayid,
            mode: details.mode
        });
    }

    const payment = await getPaymentByTxnid(txnid);
    return { payuResponse: response, payment };
}

/**
 * DEV-ONLY diagnostic: posts a throwaway transaction request to PayU's environment endpoint using
 * the configured key/salt, and reports whether PayU accepts the credentials. Never exposes the
 * salt. Useful to confirm a key/salt pair before testing the full UI flow.
 */
export async function diagnoseCredentials() {
    const payu = getPayu();
    const paymentURL =
        config.payu.env === "PROD"
            ? "https://secure.payu.in/_payment"
            : "https://test.payu.in/_payment";

    const params = {
        txnid: `diag_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        amount: "10.00",
        productinfo: "diagnostic",
        firstname: "Diagnostic",
        email: "diagnostic@example.com",
        phone: "9999999999"
    };
    const hash = payu.hasher.generatePaymentHash(params);

    const form = new URLSearchParams({
        key: config.payu.key,
        ...params,
        surl: "https://example.com/s",
        furl: "https://example.com/f",
        hash
    });

    let httpStatus = 0;
    let bodyText = "";
    try {
        const res = await fetch(paymentURL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            redirect: "manual"
        });
        httpStatus = res.status;
        bodyText = await res.text();
    } catch (cause) {
        return {
            ok: false,
            reachedPayu: false,
            env: config.payu.env,
            paymentURL,
            reason: `Could not reach PayU: ${cause.message}`
        };
    }

    // PayU returns an HTML error page (still HTTP 200) when the key/salt is wrong. Extract the
    // human-readable reason if present.
    const visible = bodyText
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

    const looksLikeError = /incorrect key or salt|not a Test Environment key|not a Production|unable to process/i.test(visible);
    const reasonMatch = visible.match(/Error Reason\s*(.*?)(?:Corrective Action|$)/i);
    const reason = reasonMatch ? reasonMatch[1].trim().slice(0, 300) : (looksLikeError ? visible.slice(0, 300) : "");

    // A 3xx redirect (or a page without the error text) means PayU accepted the credentials and
    // moved on to the actual payment page.
    const accepted = (httpStatus >= 300 && httpStatus < 400) || !looksLikeError;

    return {
        ok: accepted,
        reachedPayu: true,
        env: config.payu.env,
        paymentURL,
        httpStatus,
        keyMasked: config.payu.key ? `${config.payu.key.slice(0, 3)}***` : null,
        credentialsAccepted: accepted,
        reason: accepted ? "PayU accepted the configured key/salt." : (reason || "PayU rejected the credentials.")
    };
}
