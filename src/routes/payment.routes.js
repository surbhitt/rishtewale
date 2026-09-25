import express from "express";

import config from "../config/index.js";
import authenticateToken from "../middleware/auth.js";
import { isPayuConfigured } from "../payments/payu.js";
import {
    initiatePayment,
    reconcileCallback,
    verifyPayment,
    diagnoseCredentials
} from "../payments/payuService.js";
import { listPaymentsByUser } from "../payments/paymentsRepo.js";

const router = express.Router();

// Feature/health check for the payments module.
router.get("/status", (req, res) => {
    res.json({ configured: isPayuConfigured(), env: config.payu.env });
});

// DEV-ONLY: verify the configured PayU key/salt against PayU's environment endpoint. Disabled in
// production so it can't be used to probe live credentials. Never returns the salt.
router.get("/_diag", async (req, res) => {
    if (config.isProduction) {
        return res.status(404).json({ error: "Not found", message: "Not found" });
    }
    const result = await diagnoseCredentials();
    res.status(result.ok ? 200 : 400).json(result);
});

// Start a payment. Auth-protected: the logged-in user owns the transaction. Returns the PayU
// payment URL plus the signed params the frontend posts to PayU (server computes the hash so the
// salt never leaves the backend).
router.post("/initiate", authenticateToken, async (req, res) => {
    const { amount, productinfo, firstname, email, phone, udf } = req.body;

    const result = await initiatePayment({
        userId: req.userId,
        amount,
        productinfo,
        firstname,
        email,
        phone,
        udf
    });

    res.status(201).json(result);
});

// PayU success callback (surl). PayU POSTs form-urlencoded data here. We validate the hash before
// trusting anything, persist, then redirect the browser to the frontend success page.
router.post("/success", async (req, res) => {
    try {
        const { payment } = await reconcileCallback(req.body);
        const redirect = config.payu.successRedirectUrl;
        if (redirect) {
            const url = new URL(redirect);
            url.searchParams.set("txnid", req.body.txnid || "");
            url.searchParams.set("status", "success");
            return res.redirect(303, url.toString());
        }
        return res.json({ status: "success", payment });
    } catch (err) {
        const redirect = config.payu.failureRedirectUrl;
        if (redirect) {
            return res.redirect(303, redirect);
        }
        return res.status(err.status || 400).json({ error: err.message });
    }
});

// PayU failure callback (furl).
router.post("/failure", async (req, res) => {
    try {
        const { payment } = await reconcileCallback(req.body);
        const redirect = config.payu.failureRedirectUrl;
        if (redirect) {
            const url = new URL(redirect);
            url.searchParams.set("txnid", req.body.txnid || "");
            url.searchParams.set("status", "failure");
            return res.redirect(303, url.toString());
        }
        return res.json({ status: "failure", payment });
    } catch (err) {
        const redirect = config.payu.failureRedirectUrl;
        if (redirect) {
            return res.redirect(303, redirect);
        }
        return res.status(err.status || 400).json({ error: err.message });
    }
});

// Authoritative server-to-server verification of a transaction. Auth-protected.
router.get("/verify/:txnid", authenticateToken, async (req, res) => {
    const result = await verifyPayment(req.params.txnid);
    res.json(result);
});

// The current user's payment history.
router.get("/", authenticateToken, async (req, res) => {
    const payments = await listPaymentsByUser(req.userId);
    res.json({ payments });
});

export default router;
